import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  deferred,
  errorResponse,
  jsonResponse,
  lateJsonResponse,
  makePaper,
  makeResult,
  mockFetch,
  type Handler,
} from '../test/mockApi'
import { renderPage } from '../test/renderPage'
import type { Paper, SearchResponse } from '../types'
import SearchPage from './SearchPage'

const RESULTS: SearchResponse = {
  provider: 'semantic_scholar',
  results: [
    makeResult(),
    makeResult({ external_id: 's2:xyz', title: 'Second Paper', pdf_url: null, saved_id: null }),
  ],
}

function setup({
  search = () => jsonResponse(RESULTS),
  library = [] as Paper[],
  extra,
}: { search?: Handler; library?: Paper[]; extra?: Handler } = {}) {
  return mockFetch((req) => {
    if (req.path === '/api/search') return search(req)
    if (req.method === 'GET' && req.path === '/api/papers') return jsonResponse(library)
    return extra?.(req)
  })
}

const searchCalls = (fetch: ReturnType<typeof mockFetch>) =>
  fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/search')).map(([u]) => String(u))

describe('SearchPage', () => {
  it('shows example searches before any query', async () => {
    const fetch = setup()
    renderPage(<SearchPage />)
    expect(screen.getByRole('heading', { name: 'Find papers' })).toBeInTheDocument()
    expect(screen.getByText(/^Try/).textContent).toBe(
      'Try retrieval-augmented generation, diffusion models for video, LLM code repair',
    )
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Search',
      'retrieval-augmented generation',
      'diffusion models for video',
      'LLM code repair',
    ])
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(searchCalls(fetch)).toEqual([])
  })

  it('searches on submit, puts the query in the URL and lists results', async () => {
    const user = userEvent.setup()
    const fetch = setup()
    renderPage(<SearchPage />)
    await user.type(screen.getByRole('searchbox', { name: 'Topic or keywords' }), '  transformers  ')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('2 results for “transformers” from Semantic Scholar')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/?q=transformers')
    expect(screen.getByRole('heading', { name: 'Attention Is All You Need' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Second Paper' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Save to library' })).toHaveLength(2)
    expect(searchCalls(fetch)).toEqual(['/api/search?q=transformers&limit=10'])
    // Examples disappear once there is a query.
    expect(screen.queryByRole('button', { name: 'LLM code repair' })).not.toBeInTheDocument()
  })

  it('runs the query from the URL on load', async () => {
    const fetch = setup()
    renderPage(<SearchPage />, { route: '/?q=graph%20nets' })
    expect(await screen.findByText(/2 results for “graph nets”/)).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('graph nets')
    expect(searchCalls(fetch)).toEqual(['/api/search?q=graph+nets&limit=10'])
  })

  it('clicking an example runs that search', async () => {
    const user = userEvent.setup()
    const fetch = setup()
    renderPage(<SearchPage />)
    await user.click(screen.getByRole('button', { name: 'diffusion models for video' }))
    expect(await screen.findByText(/results for “diffusion models for video”/)).toBeInTheDocument()
    expect(screen.getByRole('searchbox')).toHaveValue('diffusion models for video')
    expect(searchCalls(fetch)).toHaveLength(1)
  })

  it('does not search for a whitespace-only query', async () => {
    const user = userEvent.setup()
    const fetch = setup()
    renderPage(<SearchPage />)
    const box = screen.getByRole('searchbox')
    await user.type(box, '    ')
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    await user.type(box, '{Enter}')
    // Even a forced submit (bypassing the disabled button) must not run an empty search.
    fireEvent.submit(screen.getByRole('search'))
    expect(searchCalls(fetch)).toEqual([])
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  it('labels arXiv results and shows an empty-result hint', async () => {
    setup({ search: () => jsonResponse({ provider: 'arxiv', results: [] }) })
    renderPage(<SearchPage />, { route: '/?q=zzzz' })
    expect(await screen.findByText('0 results for “zzzz” from arXiv')).toBeInTheDocument()
    expect(screen.getByText('No papers matched. Try broader keywords or fewer terms.')).toBeInTheDocument()
  })

  it('shows a loading state while searching', async () => {
    const pending = deferred<Response>()
    setup({ search: () => pending.promise })
    renderPage(<SearchPage />, { route: '/?q=slow' })
    const button = await screen.findByRole('button', { name: 'Searching…' })
    expect(button).toBeDisabled()
    pending.resolve(jsonResponse(RESULTS))
    expect(await screen.findByRole('button', { name: 'Search' })).toBeEnabled()
    expect(screen.getByText(/2 results/)).toBeInTheDocument()
  })

  it('shows the server error when search fails', async () => {
    setup({ search: () => errorResponse(502, 'All search providers failed: 429') })
    renderPage(<SearchPage />, { route: '/?q=x' })
    expect(await screen.findByText('Search failed: All search providers failed: 429')).toBeInTheDocument()
    expect(screen.queryByText(/results for/)).not.toBeInTheDocument()
  })

  it('recovers from an error on the next search', async () => {
    const user = userEvent.setup()
    let fail = true
    setup({ search: () => (fail ? errorResponse(502, 'down') : jsonResponse(RESULTS)) })
    renderPage(<SearchPage />, { route: '/?q=first' })
    expect(await screen.findByText('Search failed: down')).toBeInTheDocument()
    fail = false
    const box = screen.getByRole('searchbox')
    await user.clear(box)
    await user.type(box, 'second{Enter}')
    expect(await screen.findByText(/2 results for “second”/)).toBeInTheDocument()
    expect(screen.queryByText(/Search failed/)).not.toBeInTheDocument()
  })

  it('never lets an older query replace the results of a newer one', async () => {
    const user = userEvent.setup()
    const slowFirst = deferred<Response>()
    setup({
      search: (req) =>
        req.search.get('q') === 'first'
          ? slowFirst.promise
          : jsonResponse({ provider: 'semantic_scholar', results: [makeResult({ title: 'Answer to second' })] }),
    })
    renderPage(<SearchPage />, { route: '/?q=first' })
    await screen.findByRole('button', { name: 'Searching…' })
    const box = screen.getByRole('searchbox')
    await user.clear(box)
    await user.type(box, 'second')
    fireEvent.submit(screen.getByRole('search')) // the button is disabled while "first" is loading
    expect(await screen.findByText('1 results for “second” from Semantic Scholar')).toBeInTheDocument()

    // The first query's response arrives late; wait until the page has fully read it.
    const late = lateJsonResponse({ provider: 'arxiv', results: [makeResult({ title: 'Stale answer to first' })] })
    slowFirst.resolve(late.response)
    await act(() => late.read)
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled()
    expect(screen.getByText('1 results for “second” from Semantic Scholar')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Answer to second')
    expect(screen.queryByText('Stale answer to first')).not.toBeInTheDocument()
  })

  it('each result keeps its own state when a new search returns different results', async () => {
    // Two different papers can share a title (e.g. a preprint and its journal version).
    const user = userEvent.setup()
    const preprint = makeResult({ external_id: 'arxiv:1', title: 'Same Title' })
    const journal = makeResult({ external_id: 's2:2', title: 'Same Title', abstract: 'Journal version.' })
    setup({
      search: (req) =>
        jsonResponse({ provider: 'semantic_scholar', results: req.search.get('q') === 'one' ? [preprint, journal] : [journal] }),
      extra: (req) => (req.method === 'POST' ? errorResponse(500, 'disk full') : undefined),
    })
    renderPage(<SearchPage />, { route: '/?q=one' })
    const [first] = await screen.findAllByRole('article')
    await user.click(within(first).getByRole('button', { name: 'Save to library' }))
    expect(await within(first).findByText('disk full')).toBeInTheDocument()

    const box = screen.getByRole('searchbox')
    await user.clear(box)
    await user.type(box, 'two{Enter}')
    expect(await screen.findByText('1 results for “two” from Semantic Scholar')).toBeInTheDocument()
    // The journal version was never saved, so the preprint's save error must not appear on it.
    expect(screen.getByRole('article')).toHaveTextContent('Journal version.')
    expect(screen.queryByText('disk full')).not.toBeInTheDocument()
  })

  it('saves a result to the library and then links to it', async () => {
    const user = userEvent.setup()
    const saveReq = deferred<Response>()
    let posted: unknown
    setup({
      extra: (req) => {
        if (req.method === 'POST' && req.path === '/api/papers') {
          posted = req.json
          return saveReq.promise
        }
      },
    })
    renderPage(<SearchPage />, { route: '/?q=attention' })
    const card = (await screen.findByRole('heading', { name: 'Attention Is All You Need' })).closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Save to library' }))

    expect(within(card).getByRole('button', { name: 'Saving and fetching PDF…' })).toBeDisabled()
    expect(posted).toMatchObject({ external_id: 'arxiv:1706.03762', title: 'Attention Is All You Need' })

    saveReq.resolve(jsonResponse(makePaper({ id: 42, external_id: 'arxiv:1706.03762' }), 201))
    const link = await within(card).findByRole('link', { name: /Open in library/ })
    expect(link).toHaveAttribute('href', '/papers/42')
    expect(within(card).getByRole('link', { name: 'Attention Is All You Need' })).toHaveAttribute('href', '/papers/42')
    // The other result is still unsaved.
    expect(screen.getAllByRole('button', { name: 'Save to library' })).toHaveLength(1)
  })

  it('shows a save error inline, lets the user retry, and drops the error once saving works', async () => {
    const user = userEvent.setup()
    let fail = true
    setup({
      extra: (req) =>
        req.method === 'POST'
          ? fail
            ? errorResponse(500, 'disk full')
            : jsonResponse(makePaper({ id: 42, external_id: 'arxiv:1706.03762' }), 201)
          : undefined,
    })
    renderPage(<SearchPage />, { route: '/?q=attention' })
    const card = (await screen.findByRole('heading', { name: 'Attention Is All You Need' })).closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Save to library' }))
    expect(await within(card).findByText('disk full')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Save to library' })).toBeEnabled()

    fail = false
    await user.click(within(card).getByRole('button', { name: 'Save to library' }))
    expect(await within(card).findByRole('link', { name: /Open in library/ })).toHaveAttribute('href', '/papers/42')
    expect(within(card).queryByText('disk full')).not.toBeInTheDocument()
  })

  it('marks results the server reports as already saved', async () => {
    setup({
      search: () => jsonResponse({ provider: 'semantic_scholar', results: [makeResult({ saved_id: 9 })] }),
    })
    renderPage(<SearchPage />, { route: '/?q=x' })
    const link = await screen.findByRole('link', { name: /Open in library/ })
    expect(link).toHaveAttribute('href', '/papers/9')
    expect(screen.queryByRole('button', { name: 'Save to library' })).not.toBeInTheDocument()
  })

  // The API contract (types.ts / backend SearchResult) allows external_id to be null.
  const NO_ID_RESULTS: SearchResponse = {
    provider: 'semantic_scholar',
    results: [
      makeResult({ external_id: null, title: 'Untracked One' }),
      makeResult({ external_id: null, title: 'Untracked Two' }),
    ],
  }

  it('lists and saves results that have no external id', async () => {
    const user = userEvent.setup()
    let posted: unknown
    setup({
      search: () => jsonResponse(NO_ID_RESULTS),
      extra: (req) => {
        if (req.method === 'POST' && req.path === '/api/papers') {
          posted = req.json
          return jsonResponse(makePaper({ id: 61, external_id: null, title: 'Untracked One' }), 201)
        }
      },
    })
    renderPage(<SearchPage />, { route: '/?q=x' })
    expect(await screen.findByText('2 results for “x” from Semantic Scholar')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Untracked One',
      'Untracked Two',
    ])
    const card = screen.getByRole('heading', { name: 'Untracked One' }).closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Save to library' }))
    await waitFor(() => expect(posted).toEqual({ ...NO_ID_RESULTS.results[0] }))
  })

  // APP BUG: ResultEntry decides "saved" only via savedIdFor(external_id) or the server's saved_id
  // (src/pages/SearchPage.tsx:116). For a result without an external_id neither ever matches, so
  // after a successful save the card still offers "Save to library" (and the backend never dedupes
  // id-less papers, so each click adds another copy).
  it.fails('marks a result without an external id as saved after saving it', async () => {
    const user = userEvent.setup()
    setup({
      search: () => jsonResponse(NO_ID_RESULTS),
      extra: (req) =>
        req.method === 'POST' && req.path === '/api/papers'
          ? jsonResponse(makePaper({ id: 61, external_id: null, title: 'Untracked One' }), 201)
          : undefined,
    })
    renderPage(<SearchPage />, { route: '/?q=x' })
    const card = (await screen.findByRole('heading', { name: 'Untracked One' })).closest('article')!
    await user.click(within(card).getByRole('button', { name: 'Save to library' }))
    expect(await within(card).findByRole('link', { name: /Open in library/ })).toHaveAttribute('href', '/papers/61')
  })

  it('marks results that are in the local library even if the server did not', async () => {
    setup({ library: [makePaper({ id: 77, external_id: 'arxiv:1706.03762' })] })
    renderPage(<SearchPage />, { route: '/?q=x' })
    const card = (await screen.findByRole('heading', { name: 'Attention Is All You Need' })).closest('article')!
    expect(await within(card).findByRole('link', { name: /Open in library/ })).toHaveAttribute('href', '/papers/77')
  })
})
