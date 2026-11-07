import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { makeResult } from '../test/mockApi'
import type { PaperBase } from '../types'
import PaperCard from './PaperCard'

const renderCard = (paper: PaperBase, props: Partial<Parameters<typeof PaperCard>[0]> = {}) =>
  render(
    <MemoryRouter>
      <PaperCard paper={paper} {...props} />
    </MemoryRouter>,
  )

describe('PaperCard', () => {
  it('shows title, authors, year and source', () => {
    renderCard(makeResult())
    expect(screen.getByRole('heading', { name: 'Attention Is All You Need' })).toBeInTheDocument()
    expect(screen.getByText('Ashish Vaswani, Noam Shazeer')).toBeInTheDocument()
    expect(screen.getByText('2017')).toBeInTheDocument()
    expect(screen.getByText('Semantic Scholar')).toBeInTheDocument()
  })

  it.each([
    ['arxiv', 'arXiv'],
    ['upload', 'Uploaded PDF'],
    ['semantic_scholar', 'Semantic Scholar'],
  ] as const)('labels source %s as "%s"', (source, label) => {
    renderCard(makeResult({ source }))
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('title is plain text without titleHref and a link with it', () => {
    const { unmount } = renderCard(makeResult())
    expect(screen.queryByRole('link', { name: 'Attention Is All You Need' })).not.toBeInTheDocument()
    unmount()
    renderCard(makeResult(), { titleHref: '/papers/9' })
    expect(screen.getByRole('link', { name: 'Attention Is All You Need' })).toHaveAttribute('href', '/papers/9')
  })

  it('shows at most six authors and counts the rest', () => {
    const authors = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9']
    renderCard(makeResult({ authors }))
    expect(screen.getByText('A1, A2, A3, A4, A5, A6, and 3 more')).toBeInTheDocument()
    expect(screen.queryByText(/A7/)).not.toBeInTheDocument()
  })

  it('shows exactly six authors without "more"', () => {
    renderCard(makeResult({ authors: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] }))
    expect(screen.getByText('A1, A2, A3, A4, A5, A6')).toBeInTheDocument()
  })

  it('handles missing authors, year and abstract', () => {
    renderCard(makeResult({ authors: [], year: null, abstract: null }))
    expect(screen.getByText('Unknown authors')).toBeInTheDocument()
    expect(screen.getByText('Year unknown')).toBeInTheDocument()
    expect(screen.getByText('No abstract available.')).toBeInTheDocument()
  })

  it('treats an empty abstract as missing', () => {
    renderCard(makeResult({ abstract: '' }))
    expect(screen.getByText('No abstract available.')).toBeInTheDocument()
  })

  it('shows a short abstract in full with no toggle', () => {
    const abstract = 'x'.repeat(420)
    renderCard(makeResult({ abstract }))
    expect(screen.getByText(abstract)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /full abstract/ })).not.toBeInTheDocument()
  })

  it('truncates long abstracts at 420 chars and toggles the full text', async () => {
    const user = userEvent.setup()
    const abstract = 'a'.repeat(400) + ' ' + 'b'.repeat(19) + 'END-OF-ABSTRACT'
    renderCard(makeResult({ abstract }))
    const para = screen.getByText(/^a+/)
    // Exactly 420 characters, an ellipsis, then (after a space) the toggle.
    expect(para.textContent).toBe('a'.repeat(400) + ' ' + 'b'.repeat(19) + '… Show full abstract')

    await user.click(screen.getByRole('button', { name: 'Show full abstract' }))
    expect(screen.getByText(/END-OF-ABSTRACT/)).toBeInTheDocument()
    expect(screen.getByText(/END-OF-ABSTRACT/).textContent).not.toContain('…')

    await user.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText(/END-OF-ABSTRACT/)).not.toBeInTheDocument()
  })

  it('trims trailing whitespace before the ellipsis', () => {
    const abstract = 'a'.repeat(415) + '     ' + 'tail'
    renderCard(makeResult({ abstract }))
    expect(screen.getByText(/^a+/).textContent).toContain('a'.repeat(415) + '…')
  })

  it('links to the paper page and PDF in a new tab', () => {
    renderCard(makeResult())
    const view = screen.getByRole('link', { name: 'View paper' })
    const pdf = screen.getByRole('link', { name: 'PDF' })
    expect(view).toHaveAttribute('href', 'https://arxiv.org/abs/1706.03762')
    expect(pdf).toHaveAttribute('href', 'https://arxiv.org/pdf/1706.03762')
    for (const a of [view, pdf]) {
      expect(a).toHaveAttribute('target', '_blank')
      expect(a).toHaveAttribute('rel', 'noreferrer')
    }
  })

  it('omits links that are not available', () => {
    renderCard(makeResult({ url: null, pdf_url: null }))
    expect(screen.queryByRole('link', { name: 'View paper' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'PDF' })).not.toBeInTheDocument()
  })

  it('renders custom actions and badges', () => {
    renderCard(makeResult(), {
      actions: <button>Custom action</button>,
      badges: <span>Special badge</span>,
    })
    expect(screen.getByRole('button', { name: 'Custom action' })).toBeInTheDocument()
    expect(screen.getByText('Special badge')).toBeInTheDocument()
  })
})
