import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LibraryProvider, useLibrary } from './library'
import { errorResponse, jsonResponse, makePaper, makeResult, mockFetch, noContent } from './test/mockApi'
import type { Paper } from './types'

const wrapper = ({ children }: { children: ReactNode }) => <LibraryProvider>{children}</LibraryProvider>

function setup(initial: Paper[], extra?: Parameters<typeof mockFetch>[0]) {
  let papers = initial
  const fetch = mockFetch((req) => {
    const res = extra?.(req)
    if (res) return res
    if (req.method === 'GET' && req.path === '/api/papers') return jsonResponse(papers)
    return undefined
  })
  return { fetch, setPapers: (p: Paper[]) => (papers = p) }
}

describe('LibraryProvider', () => {
  it('loads the library on mount', async () => {
    const a = makePaper({ id: 1 })
    const b = makePaper({ id: 2 })
    setup([a, b])
    const { result } = renderHook(() => useLibrary(), { wrapper })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.papers).toEqual([a, b])
    expect(result.current.error).toBeNull()
  })

  it('exposes load errors and stops loading', async () => {
    mockFetch(() => errorResponse(500, 'database is locked'))
    const { result } = renderHook(() => useLibrary(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('database is locked')
    expect(result.current.papers).toEqual([])
  })

  it('refresh reloads papers and clears a previous error', async () => {
    let fail = true
    const p = makePaper()
    mockFetch(() => (fail ? errorResponse(500, 'boom') : jsonResponse([p])))
    const { result } = renderHook(() => useLibrary(), { wrapper })
    await waitFor(() => expect(result.current.error).toBe('boom'))
    fail = false
    await act(() => result.current.refresh())
    expect(result.current.error).toBeNull()
    expect(result.current.papers).toEqual([p])
  })

  it('save adds the new paper to the front of the list', async () => {
    const existing = makePaper({ id: 1 })
    const saved = makePaper({ id: 2, external_id: 'arxiv:1706.03762' })
    const { fetch } = setup([existing], (req) =>
      req.method === 'POST' && req.path === '/api/papers' ? jsonResponse(saved, 201) : undefined,
    )
    const { result } = renderHook(() => useLibrary(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let returned: Paper | undefined
    await act(async () => {
      returned = await result.current.save(makeResult())
    })
    expect(returned).toEqual(saved)
    expect(result.current.papers.map((p) => p.id)).toEqual([2, 1])
    expect(fetch).toHaveBeenCalledWith('/api/papers', expect.objectContaining({ method: 'POST' }))
  })

  it('saving a paper that is already listed does not duplicate it', async () => {
    const a = makePaper({ id: 1 })
    const b = makePaper({ id: 2 })
    setup([a, b], (req) => (req.method === 'POST' ? jsonResponse({ ...b, title: 'Updated' }, 201) : undefined))
    const { result } = renderHook(() => useLibrary(), { wrapper })
    await waitFor(() => expect(result.current.papers).toHaveLength(2))
    await act(() => result.current.save(makeResult()))
    expect(result.current.papers.map((p) => [p.id, p.title])).toEqual([
      [2, 'Updated'],
      [1, a.title],
    ])
  })

  it('save failure propagates and leaves the list unchanged', async () => {
    const a = makePaper({ id: 1 })
    setup([a], (req) => (req.method === 'POST' ? errorResponse(422, 'bad paper') : undefined))
    const { result } = renderHook(() => useLibrary(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await expect(act(() => result.current.save(makeResult()))).rejects.toThrow('bad paper')
    expect(result.current.papers).toEqual([a])
  })

  it('upload adds the uploaded paper', async () => {
    const uploaded = makePaper({ id: 5, source: 'upload' })
    const { fetch } = setup([], (req) =>
      req.path === '/api/papers/upload' ? jsonResponse(uploaded, 201) : undefined,
    )
    const { result } = renderHook(() => useLibrary(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const file = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' })
    await act(() => result.current.upload(file))
    expect(result.current.papers).toEqual([uploaded])
    expect(fetch.mock.calls.some(([u]) => u === '/api/papers/upload')).toBe(true)
  })

  it('remove deletes the paper and drops it from the list', async () => {
    const a = makePaper({ id: 1 })
    const b = makePaper({ id: 2 })
    const { fetch } = setup([a, b], (req) => (req.method === 'DELETE' ? noContent() : undefined))
    const { result } = renderHook(() => useLibrary(), { wrapper })
    await waitFor(() => expect(result.current.papers).toHaveLength(2))
    await act(() => result.current.remove(1))
    expect(result.current.papers).toEqual([b])
    expect(fetch).toHaveBeenCalledWith('/api/papers/1', { method: 'DELETE' })
  })

  it('remove failure keeps the paper', async () => {
    const a = makePaper({ id: 1 })
    setup([a], (req) => (req.method === 'DELETE' ? errorResponse(404, 'Paper not found') : undefined))
    const { result } = renderHook(() => useLibrary(), { wrapper })
    await waitFor(() => expect(result.current.papers).toHaveLength(1))
    await expect(act(() => result.current.remove(1))).rejects.toThrow('Paper not found')
    expect(result.current.papers).toEqual([a])
  })

  it('savedIdFor maps external ids to saved paper ids', async () => {
    setup([makePaper({ id: 7, external_id: 'arxiv:abc' }), makePaper({ id: 8, external_id: null })])
    const { result } = renderHook(() => useLibrary(), { wrapper })
    await waitFor(() => expect(result.current.papers).toHaveLength(2))
    expect(result.current.savedIdFor('arxiv:abc')).toBe(7)
    expect(result.current.savedIdFor('arxiv:other')).toBeUndefined()
    expect(result.current.savedIdFor(null)).toBeUndefined()
  })

  it('renders its children', async () => {
    setup([])
    render(
      <LibraryProvider>
        <p>child content</p>
      </LibraryProvider>,
    )
    expect(screen.getByText('child content')).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })
})

describe('useLibrary', () => {
  it('throws outside of a LibraryProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useLibrary())).toThrow('useLibrary must be used inside <LibraryProvider>')
  })
})
