import { describe, expect, it, vi } from 'vitest'
import { errorResponse, jsonResponse, makePaper, makeResult, mockFetch, noContent } from '../test/mockApi'
import { api } from './client'

describe('request error handling', () => {
  it('returns parsed JSON on success', async () => {
    const paper = makePaper({ id: 3 })
    mockFetch(() => jsonResponse(paper))
    await expect(api.getPaper(3)).resolves.toEqual(paper)
  })

  it('returns undefined for 204 No Content', async () => {
    mockFetch(() => noContent())
    await expect(api.deletePaper(1)).resolves.toBeUndefined()
  })

  it('uses the FastAPI "detail" string as the error message', async () => {
    mockFetch(() => errorResponse(404, 'Paper not found', 'Not Found'))
    await expect(api.getPaper(9)).rejects.toThrow('Paper not found')
  })

  // APP BUG: request() (src/api/client.ts:14) only uses `detail` when it is a string. FastAPI
  // validation errors (422) send `detail` as a list of {loc, msg, type}, so the user only ever
  // sees "422 Unprocessable Entity" and never what was actually wrong.
  it.fails('shows the messages from a FastAPI validation error (detail list)', async () => {
    mockFetch(() =>
      jsonResponse(
        {
          detail: [
            { type: 'int_parsing', loc: ['query', 'limit'], msg: 'Input should be a valid integer', input: 'x' },
          ],
        },
        422,
        'Unprocessable Entity',
      ),
    )
    await expect(api.search('x')).rejects.toThrow('Input should be a valid integer')
  })

  it('falls back to status and status text when a JSON error body has no detail', async () => {
    // e.g. a proxy or gateway answering with its own JSON error shape.
    mockFetch(() => jsonResponse({ error: 'upstream timed out' }, 504, 'Gateway Timeout'))
    await expect(api.listPapers()).rejects.toThrow(/^504 Gateway Timeout$/)
  })

  it('falls back to status and status text for non-JSON error bodies', async () => {
    mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }))
    await expect(api.listPapers()).rejects.toThrow('502 Bad Gateway')
  })

  it('reports an unreachable server with a helpful message', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(api.listPapers()).rejects.toThrow(
      'Could not reach the server. Is the backend running on port 8000?',
    )
  })
})

describe('endpoints', () => {
  it('search encodes the query and default limit', async () => {
    const fetch = mockFetch(() => jsonResponse({ provider: 'arxiv', results: [] }))
    await api.search('graph nets & GNN?')
    const url = new URL(String(fetch.mock.calls[0][0]), 'http://x')
    expect(url.pathname).toBe('/api/search')
    expect(url.searchParams.get('q')).toBe('graph nets & GNN?')
    expect(url.searchParams.get('limit')).toBe('10')
  })

  it('search passes a custom limit', async () => {
    const fetch = mockFetch(() => jsonResponse({ provider: 'arxiv', results: [] }))
    await api.search('x', 25)
    expect(String(fetch.mock.calls[0][0])).toContain('limit=25')
  })

  it('listPapers and getPaper use GET', async () => {
    const fetch = mockFetch(() => jsonResponse([]))
    await api.listPapers()
    await api.getPaper(7)
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/api/papers', '/api/papers/7'])
    expect(fetch.mock.calls.every((c) => !c[1] || !(c[1] as RequestInit).method)).toBe(true)
  })

  it('savePaper POSTs the paper as JSON', async () => {
    const fetch = mockFetch(() => jsonResponse(makePaper(), 201))
    const result = makeResult()
    await api.savePaper(result)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/papers')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual(result)
  })

  it('deletePaper sends DELETE', async () => {
    const fetch = mockFetch(() => noContent())
    await api.deletePaper(4)
    expect(fetch).toHaveBeenCalledWith('/api/papers/4', { method: 'DELETE' })
  })

  it('uploadPaper sends the file as multipart form data under "file"', async () => {
    const fetch = mockFetch(() => jsonResponse(makePaper(), 201))
    const file = new File(['%PDF-1.4'], 'paper.pdf', { type: 'application/pdf' })
    await api.uploadPaper(file)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/papers/upload')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBe(file)
    // The browser must set the multipart boundary itself.
    expect(init.headers).toBeUndefined()
  })

  it('pdfUrl builds the stored-PDF URL without fetching', () => {
    const fetch = mockFetch(() => undefined)
    expect(api.pdfUrl(12)).toBe('/api/papers/12/pdf')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('summarize POSTs with regenerate=false by default and true on request', async () => {
    const fetch = mockFetch(() => jsonResponse({ summary: 'S' }))
    await expect(api.summarize(5)).resolves.toEqual({ summary: 'S' })
    await api.summarize(5, true)
    expect(fetch.mock.calls[0]).toEqual(['/api/papers/5/summary?regenerate=false', { method: 'POST' }])
    expect(fetch.mock.calls[1][0]).toBe('/api/papers/5/summary?regenerate=true')
  })

  it('getChat, ask and clearChat hit the chat endpoint', async () => {
    const fetch = mockFetch((req) => (req.method === 'DELETE' ? noContent() : jsonResponse([])))
    await api.getChat(2)
    await api.ask(2, 'What datasets?')
    await api.clearChat(2)
    const [, askInit] = fetch.mock.calls[1] as [string, RequestInit]
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/api/papers/2/chat', '/api/papers/2/chat', '/api/papers/2/chat'])
    expect(askInit.method).toBe('POST')
    expect(JSON.parse(askInit.body as string)).toEqual({ question: 'What datasets?' })
    expect((fetch.mock.calls[2][1] as RequestInit).method).toBe('DELETE')
  })
})

describe('mock sanity', () => {
  it('unmocked requests surface as errors', async () => {
    mockFetch(() => undefined)
    await expect(api.listPapers()).rejects.toThrow(/Unmocked request/)
    expect(vi.isMockFunction(fetch)).toBe(true)
  })
})
