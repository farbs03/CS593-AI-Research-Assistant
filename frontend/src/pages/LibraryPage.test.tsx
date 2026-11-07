import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { LibraryProvider, useLibrary } from '../library'
import {
  deferred,
  errorResponse,
  jsonResponse,
  makePaper,
  mockFetch,
  noContent,
  type Handler,
} from '../test/mockApi'
import { LocationProbe, renderPage } from '../test/renderPage'
import type { Paper } from '../types'
import LibraryPage from './LibraryPage'

const PAPERS: Paper[] = [
  makePaper({ id: 1, title: 'Attention Is All You Need', authors: ['Ashish Vaswani'], abstract: 'Transformers.' }),
  makePaper({
    id: 2,
    title: 'Deep Residual Learning',
    authors: ['Kaiming He'],
    abstract: 'Residual nets for image recognition.',
    text_status: 'abstract_only',
    has_pdf: false,
  }),
  makePaper({ id: 3, title: 'BERT', authors: ['Jacob Devlin'], abstract: null }),
]

function setup(papers: Paper[] | (() => Response) = PAPERS, extra?: Handler) {
  return mockFetch((req) => {
    const res = extra?.(req)
    if (res) return res
    if (req.method === 'GET' && req.path === '/api/papers')
      return typeof papers === 'function' ? papers() : jsonResponse(papers)
  })
}

const pdfFile = (name = 'paper.pdf', type = 'application/pdf') => new File(['%PDF-1.4'], name, { type })
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement

describe('LibraryPage', () => {
  it('shows an empty-library message with a link to search', async () => {
    setup([])
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    const empty = await screen.findByText(/Your library is empty/)
    expect(within(empty).getByRole('link', { name: 'Search for papers' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('searchbox', { name: 'Filter library' })).not.toBeInTheDocument()
  })

  it('shows a load error instead of the empty message', async () => {
    setup(() => errorResponse(500, 'database unavailable'))
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    expect(await screen.findByText("Couldn't load your library: database unavailable")).toBeInTheDocument()
    expect(screen.queryByText(/Your library is empty/)).not.toBeInTheDocument()
  })

  it('lists saved papers with links and abstract-only badges', async () => {
    setup()
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    expect(await screen.findByText('3 of 3 papers')).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByRole('link', { name: 'Attention Is All You Need' })).toHaveAttribute('href', '/papers/1')
    expect(within(items[0]).getByRole('link', { name: 'Summarize & ask' })).toHaveAttribute('href', '/papers/1')
    expect(within(items[0]).queryByText('Abstract only')).not.toBeInTheDocument()
    expect(within(items[1]).getByText('Abstract only')).toBeInTheDocument()
    expect(screen.getAllByText('Abstract only')).toHaveLength(1)
    expect(screen.queryByText(/Your library is empty/)).not.toBeInTheDocument()
  })

  it('does not claim the library is empty while it is still loading', async () => {
    const list = deferred<Response>()
    setup(() => list.promise as unknown as Response)
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    expect(screen.getByRole('button', { name: 'Upload PDF' })).toBeInTheDocument()
    expect(screen.queryByText(/Your library is empty/)).not.toBeInTheDocument()
    list.resolve(jsonResponse([]))
    expect(await screen.findByText(/Your library is empty/)).toBeInTheDocument()
  })

  it.each([
    ['title', 'residual', ['Deep Residual Learning']],
    ['author (case-insensitive)', 'DEVLIN', ['BERT']],
    ['abstract', 'transformers', ['Attention Is All You Need']],
    ['surrounding whitespace', '  bert  ', ['BERT']],
  ])('filters by %s', async (_label, text, expected) => {
    const user = userEvent.setup()
    setup()
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    await user.type(await screen.findByRole('searchbox', { name: 'Filter library' }), text)
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles).toEqual(expected)
    expect(screen.getByText(`${expected.length} of 3 papers`)).toBeInTheDocument()
  })

  it('filter with no matches shows 0 of N', async () => {
    const user = userEvent.setup()
    setup()
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    await user.type(await screen.findByRole('searchbox', { name: 'Filter library' }), 'quantum gravity')
    expect(screen.getByText('0 of 3 papers')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('uploads a chosen PDF and opens the new paper', async () => {
    const user = userEvent.setup()
    const uploadReq = deferred<Response>()
    let sentFile: unknown
    setup([], (req) => {
      if (req.path === '/api/papers/upload') {
        sentFile = (req.init?.body as FormData).get('file')
        return uploadReq.promise
      }
    })
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    await screen.findByText(/Your library is empty/)

    const file = pdfFile('my-paper.pdf')
    await user.upload(fileInput(), file)
    expect(await screen.findByText(/Reading/)).toHaveTextContent(
      'Reading my-paper.pdf and extracting its title, authors, year, and abstract…',
    )
    expect(screen.queryByRole('button', { name: 'Upload PDF' })).not.toBeInTheDocument()
    expect(sentFile).toBe(file)

    uploadReq.resolve(jsonResponse(makePaper({ id: 55, source: 'upload' }), 201))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/papers/55'))
  })

  it('an upload that finishes after the user left the page still lands in the library', async () => {
    const user = userEvent.setup()
    const uploadReq = deferred<Response>()
    setup([], (req) => (req.path === '/api/papers/upload' ? uploadReq.promise : undefined))
    function LibraryTitles() {
      const { papers } = useLibrary()
      return <ul aria-label="library titles">{papers.map((p) => <li key={p.id}>{p.title}</li>)}</ul>
    }
    render(
      <MemoryRouter initialEntries={['/library']}>
        <LibraryProvider>
          <Routes>
            <Route path="/library" element={<LibraryPage />} />
            <Route path="*" element={<LibraryTitles />} />
          </Routes>
          <LocationProbe />
        </LibraryProvider>
      </MemoryRouter>,
    )
    await screen.findByText(/Your library is empty/)
    await user.upload(fileInput(), pdfFile('slow.pdf'))
    await screen.findByText(/Reading/)

    // Leave the Library page while the upload is still in flight (LibraryPage unmounts).
    await user.click(screen.getByRole('link', { name: 'Search for papers' }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    expect(fileInput()).toBeNull()

    uploadReq.resolve(jsonResponse(makePaper({ id: 56, title: 'Slow Upload', source: 'upload' }), 201))
    const titles = await screen.findByRole('list', { name: 'library titles' })
    await waitFor(() => expect(within(titles).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Slow Upload']))
    expect(screen.queryByText(/Upload failed/)).not.toBeInTheDocument()
  })

  it('the Upload PDF button opens the file picker', async () => {
    const user = userEvent.setup()
    setup([])
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    const click = vi.spyOn(fileInput(), 'click')
    await user.click(screen.getByRole('button', { name: 'Upload PDF' }))
    expect(click).toHaveBeenCalled()
  })

  it.each([
    ['Scan.PDF', ''],
    ['paper.Pdf', 'application/octet-stream'],
    ['download', 'application/pdf'],
  ])('accepts %s (type "%s") as a PDF', async (name, type) => {
    const user = userEvent.setup({ applyAccept: false })
    const fetch = setup([], (req) =>
      req.path === '/api/papers/upload' ? jsonResponse(makePaper({ id: 9 }), 201) : undefined,
    )
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    await user.upload(fileInput(), pdfFile(name, type))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/papers/9'))
    expect(fetch.mock.calls.filter(([u]) => u === '/api/papers/upload')).toHaveLength(1)
  })

  it.each([
    ['notes.txt', 'text/plain'],
    ['paper.pdf.txt', 'text/plain'],
    ['pdf', ''],
  ])('rejects %s (type "%s") without uploading', async (name, type) => {
    const user = userEvent.setup({ applyAccept: false })
    const fetch = setup([])
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    await user.upload(fileInput(), new File(['hello'], name, { type }))
    expect(await screen.findByText(`Upload failed: ${name} isn't a PDF. Choose a .pdf file.`)).toBeInTheDocument()
    expect(fetch.mock.calls.some(([u]) => u === '/api/papers/upload')).toBe(false)
  })

  it('shows the server error when an upload fails and stays on the page', async () => {
    const user = userEvent.setup()
    setup([], (req) => (req.path === '/api/papers/upload' ? errorResponse(400, 'File is not a PDF') : undefined))
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    await user.upload(fileInput(), pdfFile())
    expect(await screen.findByText('Upload failed: File is not a PDF')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload PDF' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/library')
    expect(fileInput().value).toBe('')
  })

  it('clears a previous upload error on the next attempt', async () => {
    const user = userEvent.setup({ applyAccept: false })
    setup([], (req) => (req.path === '/api/papers/upload' ? jsonResponse(makePaper({ id: 3 }), 201) : undefined))
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    await user.upload(fileInput(), new File(['x'], 'a.docx', { type: 'application/msword' }))
    expect(await screen.findByText(/isn't a PDF/)).toBeInTheDocument()
    await user.upload(fileInput(), pdfFile())
    await waitFor(() => expect(screen.queryByText(/isn't a PDF/)).not.toBeInTheDocument())
  })

  it('uploads a PDF dropped on the drop zone', async () => {
    setup([], (req) => (req.path === '/api/papers/upload' ? jsonResponse(makePaper({ id: 12 }), 201) : undefined))
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    const zone = screen.getByText('Drop a paper PDF here, or').parentElement!
    expect(zone).toHaveClass('dropzone', { exact: true })
    // fireEvent returns false when the page called preventDefault(). Browsers only allow a drop
    // when dragover is cancelled, and open the dropped file themselves unless drop is cancelled.
    expect(fireEvent.dragOver(zone)).toBe(false)
    expect(zone).toHaveClass('dropzone dragging', { exact: true })
    fireEvent.dragLeave(zone)
    expect(zone).toHaveClass('dropzone', { exact: true })
    fireEvent.dragOver(zone)
    expect(fireEvent.drop(zone, { dataTransfer: { files: [pdfFile('dropped.pdf')] } })).toBe(false)
    expect(zone).not.toHaveClass('dragging')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/papers/12'))
  })

  it('ignores a drop without files', async () => {
    const fetch = setup([])
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    const zone = screen.getByText('Drop a paper PDF here, or').parentElement!
    fireEvent.drop(zone, { dataTransfer: { files: [] } })
    await screen.findByText(/Your library is empty/)
    expect(fetch.mock.calls.some(([u]) => u === '/api/papers/upload')).toBe(false)
    expect(screen.queryByText(/Upload failed/)).not.toBeInTheDocument()
  })

  it('removes a paper after confirmation', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fetch = setup(PAPERS, (req) => (req.method === 'DELETE' ? noContent() : undefined))
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    const item = (await screen.findByRole('link', { name: 'BERT' })).closest('li')!
    await user.click(within(item).getByRole('button', { name: 'Remove' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Remove “BERT” from your library?'))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'BERT' })).not.toBeInTheDocument())
    expect(screen.getByText('2 of 2 papers')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/papers/3', { method: 'DELETE' })
  })

  it('keeps the paper when removal is cancelled', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fetch = setup()
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    const item = (await screen.findByRole('link', { name: 'BERT' })).closest('li')!
    await user.click(within(item).getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('link', { name: 'BERT' })).toBeInTheDocument()
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
  })

  it('alerts when removal fails and keeps the paper', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    setup(PAPERS, (req) => (req.method === 'DELETE' ? errorResponse(500, 'cannot delete') : undefined))
    renderPage(<LibraryPage />, { route: '/library', path: '/library' })
    const item = (await screen.findByRole('link', { name: 'BERT' })).closest('li')!
    await user.click(within(item).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(alert).toHaveBeenCalledWith('cannot delete'))
    expect(screen.getByRole('link', { name: 'BERT' })).toBeInTheDocument()
  })
})
