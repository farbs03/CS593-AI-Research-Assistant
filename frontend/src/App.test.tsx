import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { jsonResponse, makePaper, makeResult, mockFetch } from './test/mockApi'

beforeEach(() => {
  window.history.pushState({}, '', '/')
  Element.prototype.scrollIntoView = vi.fn()
})

function setup(papers = [makePaper({ id: 1, title: 'Saved One' }), makePaper({ id: 2, title: 'Saved Two' })]) {
  return mockFetch((req) => {
    if (req.path === '/api/papers' && req.method === 'GET') return jsonResponse(papers)
    if (req.path === '/api/papers' && req.method === 'POST')
      return jsonResponse(makePaper({ id: 3, title: 'Attention Is All You Need', external_id: 'arxiv:1706.03762' }), 201)
    if (req.path === '/api/search') return jsonResponse({ provider: 'semantic_scholar', results: [makeResult()] })
    const m = req.path.match(/^\/api\/papers\/(\d+)$/)
    if (m) return jsonResponse(papers.find((p) => p.id === Number(m[1])) ?? makePaper({ id: Number(m[1]) }))
    if (req.path.endsWith('/chat')) return jsonResponse([])
  })
}

describe('App', () => {
  it('starts on the search page with navigation and a library count', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('heading', { name: 'Find papers' })).toBeInTheDocument()
    expect(await within(nav).findByLabelText('2 papers')).toHaveTextContent('2')
  })

  it('navigates between pages and scrolls to the top on each navigation', async () => {
    const user = userEvent.setup()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const initialScrolls = scrollTo.mock.calls.length
    expect(scrollTo).toHaveBeenCalledWith(0, 0)

    await user.click(within(nav).getByRole('link', { name: /Library/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/library')
    expect(within(nav).getByRole('link', { name: /Library/ })).toHaveClass('active')
    expect(scrollTo.mock.calls.length).toBeGreaterThan(initialScrolls)

    await user.click(await screen.findByRole('link', { name: 'Saved Two' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Saved Two' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/papers/2')

    await user.click(within(nav).getByRole('link', { name: 'Search' }))
    expect(await screen.findByRole('heading', { name: 'Find papers' })).toBeInTheDocument()
  })

  it('saving a search result updates the library count in the nav', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    await within(nav).findByLabelText('2 papers')
    await user.type(screen.getByRole('searchbox'), 'attention{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Save to library' }))
    await waitFor(() => expect(within(nav).getByLabelText('3 papers')).toHaveTextContent('3'))
    expect(screen.getByRole('link', { name: /Open in library/ })).toHaveAttribute('href', '/papers/3')
  })
})
