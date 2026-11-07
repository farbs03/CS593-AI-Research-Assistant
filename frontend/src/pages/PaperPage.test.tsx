import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calls,
  deferred,
  errorResponse,
  jsonResponse,
  lateJsonResponse,
  makeMessage,
  makePaper,
  mockFetch,
  noContent,
  type Handler,
} from '../test/mockApi'
import { renderPage } from '../test/renderPage'
import type { ChatMessage, Paper } from '../types'
import PaperPage from './PaperPage'

const PAPER = makePaper({
  id: 7,
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  year: 2017,
  abstract: 'The dominant sequence transduction models.',
  url: 'https://arxiv.org/abs/1706.03762',
  has_pdf: true,
  text_status: 'full',
  summary: null,
})

interface Opts {
  paper?: Paper | (() => Response)
  chat?: ChatMessage[] | (() => Response)
  extra?: Handler
}

function setup({ paper = PAPER, chat = [], extra }: Opts = {}) {
  return mockFetch((req) => {
    const res = extra?.(req)
    if (res) return res
    if (req.method === 'GET' && req.path === '/api/papers') return jsonResponse([])
    if (req.method === 'GET' && req.path === `/api/papers/7`)
      return typeof paper === 'function' ? paper() : jsonResponse(paper)
    if (req.method === 'GET' && req.path === `/api/papers/7/chat`)
      return typeof chat === 'function' ? chat() : jsonResponse(chat)
  })
}

const renderPaper = (id: number | string = 7) =>
  renderPage(<PaperPage />, { route: `/papers/${id}`, path: '/papers/:id' })

/** Paper 7's page plus an in-app link to paper 8, to test moving from one paper to another. */
const renderWithNextLink = () =>
  renderPage(
    <>
      <PaperPage />
      <Link to="/papers/8">Next paper</Link>
    </>,
    { route: '/papers/7', path: '/papers/:id' },
  )

const PAPER_8 = makePaper({ id: 8, title: 'BERT', abstract: 'Bidirectional encoders.' })

const chatPanel = () => screen.getByRole('complementary', { name: 'Questions about this paper' })

beforeEach(() => {
  // jsdom does not implement scrollIntoView; the chat log scrolls to the newest message.
  Element.prototype.scrollIntoView = vi.fn()
})

describe('PaperPage details', () => {
  it('shows a loading message, then the paper', async () => {
    const paper = deferred<Response>()
    setup({ paper: () => paper.promise as unknown as Response })
    renderPaper()
    expect(screen.getByText('Loading paper…')).toBeInTheDocument()
    paper.resolve(jsonResponse(PAPER))
    expect(await screen.findByRole('heading', { level: 1, name: 'Attention Is All You Need' })).toBeInTheDocument()
    expect(screen.queryByText('Loading paper…')).not.toBeInTheDocument()
  })

  it('renders metadata, abstract and links', async () => {
    setup()
    renderPaper()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText('Ashish Vaswani, Noam Shazeer')).toBeInTheDocument()
    expect(screen.getByText('2017')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Abstract' })).toBeInTheDocument()
    expect(screen.getByText('The dominant sequence transduction models.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', '/api/papers/7/pdf')
    expect(screen.getByRole('link', { name: 'View source page' })).toHaveAttribute('href', 'https://arxiv.org/abs/1706.03762')
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/library')
    expect(screen.queryByText(/No full text is available/)).not.toBeInTheDocument()
  })

  it('handles a paper with minimal metadata', async () => {
    setup({
      paper: makePaper({ id: 7, authors: [], year: null, abstract: null, url: null, has_pdf: false }),
    })
    renderPaper()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText('Unknown authors')).toBeInTheDocument()
    expect(screen.getByText('Year unknown')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Abstract' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open PDF' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View source page' })).not.toBeInTheDocument()
  })

  it('warns when only the abstract is available', async () => {
    setup({ paper: { ...PAPER, text_status: 'abstract_only', has_pdf: false } })
    renderPaper()
    const notice = await screen.findByText(/No full text is available for this paper/)
    expect(within(notice).getByRole('link', { name: 'upload it to your library' })).toHaveAttribute('href', '/library')
    expect(screen.getByText(/written from the paper's abstract/)).toBeInTheDocument()
  })

  it('shows an error for a missing paper', async () => {
    setup({ paper: () => errorResponse(404, 'Paper not found') })
    renderPaper()
    expect(await screen.findByText("Couldn't open this paper: Paper not found")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to library' })).toHaveAttribute('href', '/library')
  })

  // APP BUG: PaperPage does `Number(useParams().id)` (src/pages/PaperPage.tsx:18) without
  // validating it, so /papers/abc requests /api/papers/NaN and shows the backend's raw
  // "422 Unprocessable Entity". An invalid id should be reported as such, without a request.
  it.fails('rejects a non-numeric paper id without requesting /api/papers/NaN', async () => {
    const fetch = mockFetch((req) => {
      if (req.path === '/api/papers') return jsonResponse([])
      // What the real backend answers for a non-integer id.
      return jsonResponse(
        { detail: [{ type: 'int_parsing', loc: ['path', 'paper_id'], msg: 'Input should be a valid integer' }] },
        422,
        'Unprocessable Entity',
      )
    })
    renderPaper('abc')
    // The page's error view (with its way back) is shown...
    expect(await screen.findByRole('link', { name: 'Back to library' })).toBeInTheDocument()
    // ...without asking the server for a paper id that cannot exist...
    expect(calls(fetch).filter((c) => c !== 'GET /api/papers')).toEqual([])
    // ...and without leaking a raw HTTP status line to the user.
    expect(screen.getByText(/Couldn't open this paper/)).not.toHaveTextContent(/422|Unprocessable|NaN/)
  })
})

describe('PaperPage navigation between papers', () => {
  it('shows only the new paper (and its chat) after navigating from another paper', async () => {
    const user = userEvent.setup()
    const next = deferred<Response>()
    setup({
      chat: [makeMessage({ id: 1, paper_id: 7, role: 'user', content: 'Question about paper 7' })],
      extra: (req) => {
        if (req.path === '/api/papers/8') return next.promise
        if (req.path === '/api/papers/8/chat')
          return jsonResponse([makeMessage({ id: 2, paper_id: 8, role: 'user', content: 'Question about BERT' })])
      },
    })
    renderWithNextLink()
    expect(await screen.findByText('Question about paper 7')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Next paper' }))
    // While paper 8 loads, nothing of paper 7 is left on screen.
    expect(await screen.findByText('Loading paper…')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByText('Question about paper 7')).not.toBeInTheDocument()

    next.resolve(jsonResponse(PAPER_8))
    expect(await screen.findByRole('heading', { level: 1, name: 'BERT' })).toBeInTheDocument()
    expect(await screen.findByText('Question about BERT')).toBeInTheDocument()
    expect(screen.queryByText('Question about paper 7')).not.toBeInTheDocument()
  })

  // APP BUG: the load effect (src/pages/PaperPage.tsx:23-27) never ignores the response for an id
  // the user has already navigated away from, so a slow response for the previous paper replaces
  // the paper that is now in the URL.
  it.fails('a slow response for the previous paper never replaces the current one', async () => {
    const user = userEvent.setup()
    const slow7 = deferred<Response>()
    setup({
      paper: () => slow7.promise as unknown as Response,
      extra: (req) => {
        if (req.path === '/api/papers/8') return jsonResponse(PAPER_8)
        if (req.path === '/api/papers/8/chat') return jsonResponse([])
      },
    })
    renderWithNextLink()
    expect(screen.getByText('Loading paper…')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Next paper' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'BERT' })).toBeInTheDocument()

    const late = lateJsonResponse(PAPER)
    slow7.resolve(late.response)
    await act(() => late.read)
    expect(screen.getByTestId('location')).toHaveTextContent('/papers/8')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('BERT')
  })

  // APP BUG: SummaryPanel's onSummary callback (src/pages/PaperPage.tsx:79-82) closes over the
  // paper it was rendered for and calls setPaper({ ...paper, summary }). If the summary arrives
  // after the user moved on to another paper, the old paper (with its summary) replaces the new one.
  it.fails('a summary that finishes after leaving the paper does not bring that paper back', async () => {
    const user = userEvent.setup()
    const summary = deferred<Response>()
    setup({
      extra: (req) => {
        if (req.path === '/api/papers/7/summary') return summary.promise
        if (req.path === '/api/papers/8') return jsonResponse(PAPER_8)
        if (req.path === '/api/papers/8/chat') return jsonResponse([])
      },
    })
    renderWithNextLink()
    await user.click(await screen.findByRole('button', { name: 'Summarize paper' }))
    await user.click(screen.getByRole('link', { name: 'Next paper' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'BERT' })).toBeInTheDocument()

    const late = lateJsonResponse({ summary: 'Summary of paper 7' })
    summary.resolve(late.response)
    await act(() => late.read)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('BERT')
    expect(screen.queryByText('Summary of paper 7')).not.toBeInTheDocument()
  })
})

describe('PaperPage summary', () => {
  it('summarizes on request, renders markdown and refreshes the library', async () => {
    const user = userEvent.setup()
    const summary = deferred<Response>()
    const fetch = setup({
      extra: (req) => (req.path === '/api/papers/7/summary' ? summary.promise : undefined),
    })
    renderPaper()
    expect(await screen.findByText(/written from the paper's full text/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Summarize paper' }))

    expect(screen.getByRole('button', { name: 'Reading the paper…' })).toBeDisabled()
    const listCallsBefore = fetch.mock.calls.filter(([u]) => u === '/api/papers').length
    summary.resolve(jsonResponse({ summary: '## TL;DR\nIt is **great**.\n\n## Limitations\nNone.' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'TL;DR' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Limitations' })).toBeInTheDocument()
    expect(screen.getByText('great').tagName).toBe('STRONG')
    expect(screen.queryByRole('button', { name: 'Summarize paper' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
    expect(fetch).toHaveBeenCalledWith('/api/papers/7/summary?regenerate=false', { method: 'POST' })
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([u]) => u === '/api/papers').length).toBe(listCallsBefore + 1),
    )
  })

  it('shows a cached summary and regenerates it', async () => {
    const user = userEvent.setup()
    const regen = deferred<Response>()
    const fetch = setup({
      paper: { ...PAPER, summary: 'Old summary text' },
      extra: (req) => (req.path === '/api/papers/7/summary' ? regen.promise : undefined),
    })
    renderPaper()
    expect(await screen.findByText('Old summary text')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(screen.getByRole('button', { name: 'Regenerating…' })).toBeDisabled()
    regen.resolve(jsonResponse({ summary: 'Fresh summary text' }))
    expect(await screen.findByText('Fresh summary text')).toBeInTheDocument()
    expect(screen.queryByText('Old summary text')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/papers/7/summary?regenerate=true', { method: 'POST' })
  })

  it('shows summary errors and allows retry', async () => {
    const user = userEvent.setup()
    let fail = true
    setup({
      extra: (req) =>
        req.path === '/api/papers/7/summary'
          ? fail
            ? errorResponse(502, 'LLM request failed: timeout')
            : jsonResponse({ summary: 'Recovered' })
          : undefined,
    })
    renderPaper()
    await user.click(await screen.findByRole('button', { name: 'Summarize paper' }))
    expect(await screen.findByText('Summary failed: LLM request failed: timeout')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Summarize paper' })).toBeEnabled()

    fail = false
    await user.click(screen.getByRole('button', { name: 'Summarize paper' }))
    expect(await screen.findByText('Recovered')).toBeInTheDocument()
    expect(screen.queryByText(/Summary failed/)).not.toBeInTheDocument()
  })
})

describe('PaperPage chat', () => {
  it('shows suggested questions when there is no history', async () => {
    setup()
    renderPaper()
    const panel = await waitFor(() => chatPanel())
    expect(within(panel).getByText('Ask anything, or start with one of these:')).toBeInTheDocument()
    expect(within(panel).getAllByRole('button', { name: /\?$/ })).toHaveLength(5)
    expect(within(panel).queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Ask' })).toBeDisabled()
  })

  it('loads and renders existing chat history', async () => {
    setup({
      chat: [
        makeMessage({ id: 1, paper_id: 7, role: 'user', content: 'What is **self-attention**?' }),
        makeMessage({ id: 2, paper_id: 7, role: 'assistant', content: 'A **transformer**.' }),
      ],
    })
    renderPaper()
    // The user's own words are shown exactly as typed; only answers are rendered as Markdown.
    expect((await screen.findByText('What is **self-attention**?')).tagName).toBe('P')
    expect(screen.getByText('transformer').tagName).toBe('STRONG')
    expect(screen.queryByText('Ask anything, or start with one of these:')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('shows no messages and no Clear button while the history is still loading', async () => {
    const history = deferred<Response>()
    setup({ chat: () => history.promise as unknown as Response })
    renderPaper()
    const panel = await waitFor(() => chatPanel())
    expect(panel.querySelectorAll('.msg')).toHaveLength(0)
    expect(within(panel).queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    history.resolve(jsonResponse([makeMessage({ id: 1, paper_id: 7, role: 'user', content: 'Earlier question' })]))
    expect(await within(panel).findByText('Earlier question')).toBeInTheDocument()
    expect(panel.querySelectorAll('.msg')).toHaveLength(1)
  })

  // APP BUG: ChatPanel stores history-load failures (src/pages/PaperPage.tsx:145) in the same
  // `error` state as failed questions and renders it as "Couldn't get an answer: ..."
  // (PaperPage.tsx:224), although no question was asked. The message should say the history
  // could not be loaded.
  it.fails('says the Q&A history could not be loaded when loading it fails', async () => {
    setup({ chat: () => errorResponse(500, 'chat db error') })
    renderPaper()
    const message = await within(await waitFor(() => chatPanel())).findByText(/chat db error/)
    expect(message).not.toHaveTextContent("Couldn't get an answer")
    expect(message).toHaveTextContent(/load/i)
    expect(message).toHaveTextContent(/history/i)
  })

  it('asks a typed question, shows pending state, then the answer', async () => {
    const user = userEvent.setup()
    const answer = deferred<Response>()
    let body: unknown
    setup({
      extra: (req) => {
        if (req.method === 'POST' && req.path === '/api/papers/7/chat') {
          body = req.json
          return answer.promise
        }
      },
    })
    renderPaper()
    const box = await screen.findByRole('textbox', { name: 'Your question' })
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView)
    await user.type(box, '  What datasets are used?  ')
    // The page handles the submission itself: the browser must not also submit the form (reload).
    const submits: boolean[] = []
    const onSubmit = (e: Event) => submits.push(e.defaultPrevented)
    document.addEventListener('submit', onSubmit)
    try {
      await user.click(screen.getByRole('button', { name: 'Ask' }))
    } finally {
      document.removeEventListener('submit', onSubmit)
    }
    expect(submits).toEqual([true])

    expect(body).toEqual({ question: 'What datasets are used?' })
    expect(box).toHaveValue('')
    expect(screen.getByText('Reading the paper…')).toBeInTheDocument()
    expect(screen.getByText('What datasets are used?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()

    // Only count scrolls caused by the answer arriving (not the ones on mount / while pending).
    scrollIntoView.mockClear()
    answer.resolve(
      jsonResponse([
        makeMessage({ id: 10, paper_id: 7, role: 'user', content: 'What datasets are used?' }),
        makeMessage({ id: 11, paper_id: 7, role: 'assistant', content: 'WMT 2014 English-German.' }),
      ]),
    )
    expect(await screen.findByText('WMT 2014 English-German.')).toBeInTheDocument()
    expect(screen.queryByText('Reading the paper…')).not.toBeInTheDocument()
    expect(screen.getAllByText('What datasets are used?')).toHaveLength(1)
    // The log scrolled (smoothly) to its end marker, which now sits after the new answer.
    const log = chatPanel().querySelector('.chat-log')!
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'nearest' })
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(log.lastElementChild)
    expect(log.lastElementChild!.previousElementSibling).toHaveTextContent('WMT 2014 English-German.')
  })

  it('clicking a suggested question asks it', async () => {
    const user = userEvent.setup()
    let body: unknown
    setup({
      extra: (req) => {
        if (req.method === 'POST' && req.path === '/api/papers/7/chat') {
          body = req.json
          return jsonResponse([
            makeMessage({ id: 20, role: 'user', content: 'What are the major limitations?' }),
            makeMessage({ id: 21, role: 'assistant', content: 'Quadratic attention cost.' }),
          ])
        }
      },
    })
    renderPaper()
    await user.click(await screen.findByRole('button', { name: 'What are the major limitations?' }))
    expect(await screen.findByText('Quadratic attention cost.')).toBeInTheDocument()
    expect(body).toEqual({ question: 'What are the major limitations?' })
    expect(screen.queryByRole('button', { name: 'What datasets are used?' })).not.toBeInTheDocument()
  })

  it('Enter submits but Shift+Enter inserts a newline', async () => {
    const user = userEvent.setup()
    const asked: unknown[] = []
    setup({
      extra: (req) => {
        if (req.method === 'POST' && req.path === '/api/papers/7/chat') {
          asked.push(req.json)
          return jsonResponse([
            makeMessage({ id: 30, role: 'user', content: 'line one\nline two' }),
            makeMessage({ id: 31, role: 'assistant', content: 'ok' }),
          ])
        }
      },
    })
    renderPaper()
    const box = await screen.findByRole('textbox', { name: 'Your question' })
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(box).toHaveValue('line one\nline two')
    expect(asked).toEqual([])
    await user.type(box, '{Enter}')
    await waitFor(() => expect(asked).toEqual([{ question: 'line one\nline two' }]))
    expect(await screen.findByText('ok')).toBeInTheDocument()
    expect(box).toHaveValue('') // the Enter that sent the question did not also type a newline
  })

  it('does not send blank questions', async () => {
    const user = userEvent.setup()
    const fetch = setup()
    renderPaper()
    const box = await screen.findByRole('textbox', { name: 'Your question' })
    await user.type(box, '   {Enter}')
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)
  })

  it('restores the question and shows the error when asking fails', async () => {
    const user = userEvent.setup()
    setup({
      extra: (req) =>
        req.method === 'POST' && req.path === '/api/papers/7/chat'
          ? errorResponse(502, 'LLM request failed: rate limit')
          : undefined,
    })
    renderPaper()
    const box = await screen.findByRole('textbox', { name: 'Your question' })
    await user.type(box, 'Why?{Enter}')
    expect(await screen.findByText("Couldn't get an answer: LLM request failed: rate limit")).toBeInTheDocument()
    expect(box).toHaveValue('Why?')
    expect(screen.queryByText('Reading the paper…')).not.toBeInTheDocument()
    // Suggestions come back since nothing was added to the history.
    expect(screen.getByText('Ask anything, or start with one of these:')).toBeInTheDocument()
  })

  it('appends follow-up answers after earlier messages', async () => {
    const user = userEvent.setup()
    setup({
      chat: [
        makeMessage({ id: 1, role: 'user', content: 'First question' }),
        makeMessage({ id: 2, role: 'assistant', content: 'First answer' }),
      ],
      extra: (req) =>
        req.method === 'POST'
          ? jsonResponse([
              makeMessage({ id: 3, role: 'user', content: 'Second question' }),
              makeMessage({ id: 4, role: 'assistant', content: 'Second answer' }),
            ])
          : undefined,
    })
    renderPaper()
    await screen.findByText('First answer')
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Second question{Enter}')
    await screen.findByText('Second answer')
    const log = chatPanel().querySelector('.chat-log')!
    expect(Array.from(log.querySelectorAll('.msg')).map((m) => m.textContent)).toEqual([
      'First question',
      'First answer',
      'Second question',
      'Second answer',
    ])
  })

  it('clears the history after confirmation', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetch = setup({
      chat: [makeMessage({ id: 1, role: 'user', content: 'Old question' })],
      extra: (req) => (req.method === 'DELETE' && req.path === '/api/papers/7/chat' ? noContent() : undefined),
    })
    renderPaper()
    await screen.findByText('Old question')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(confirm).toHaveBeenCalledWith('Clear this Q&A history?')
    await waitFor(() => expect(screen.queryByText('Old question')).not.toBeInTheDocument())
    expect(screen.getByText('Ask anything, or start with one of these:')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/papers/7/chat', { method: 'DELETE' })
  })

  it('keeps the history when clearing is cancelled', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fetch = setup({ chat: [makeMessage({ id: 1, role: 'user', content: 'Keep me' })] })
    renderPaper()
    await screen.findByText('Keep me')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('Keep me')).toBeInTheDocument()
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
  })
})
