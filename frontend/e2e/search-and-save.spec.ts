import { expect, test } from '@playwright/test'
import { papers, resetLibrary } from './helpers'

test.beforeEach(async ({ request }) => {
  await resetLibrary(request)
})

test('search, save a paper with a PDF and one without, then see both in the library', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Find papers' })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByLabel('0 papers')).toBeVisible()

  await page.getByRole('searchbox', { name: 'Topic or keywords' }).fill('attention transformers')
  await page.getByRole('button', { name: 'Search' }).click()

  await expect(page).toHaveURL(/\?q=attention\+transformers$/)
  await expect(page.getByText('2 results for “attention transformers” from Semantic Scholar')).toBeVisible()

  const withPdf = page.getByRole('article').filter({ hasText: 'Attention Is All You Need' })
  const noPdf = page.getByRole('article').filter({ hasText: 'A Paper Without A PDF' })
  await expect(withPdf.getByText('Ashish Vaswani, Noam Shazeer, Niki Parmar')).toBeVisible()
  await expect(withPdf.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', 'https://arxiv.org/pdf/1706.03762')
  await expect(noPdf.getByRole('link', { name: 'PDF' })).toHaveCount(0)

  await withPdf.getByRole('button', { name: 'Save to library' }).click()
  const openLink = withPdf.getByRole('link', { name: /Open in library/ })
  await expect(openLink).toBeVisible()
  await expect(nav.getByLabel('1 papers')).toBeVisible()

  await noPdf.getByRole('button', { name: 'Save to library' }).click()
  await expect(noPdf.getByRole('link', { name: /Open in library/ })).toBeVisible()
  await expect(nav.getByLabel('2 papers')).toBeVisible()

  // Re-running the search remembers what is already saved (server-side saved_id).
  await page.reload()
  await expect(page.getByRole('button', { name: 'Save to library' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Open in library/ })).toHaveCount(2)

  await nav.getByRole('link', { name: /Library/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  await expect(page.getByText('2 of 2 papers')).toBeVisible()
  const savedWithPdf = papers(page).filter({ hasText: 'Attention Is All You Need' })
  const savedNoPdf = papers(page).filter({ hasText: 'A Paper Without A PDF' })
  await expect(savedWithPdf.getByText('Abstract only')).toHaveCount(0)
  await expect(savedNoPdf.getByText('Abstract only')).toBeVisible()
})

test('search query survives navigating to a paper and back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'LLM code repair' }).click()
  await expect(page.getByText(/2 results for “LLM code repair”/)).toBeVisible()
  const card = page.getByRole('article').filter({ hasText: 'A Paper Without A PDF' })
  await card.getByRole('button', { name: 'Save to library' }).click()
  await card.getByRole('link', { name: /Open in library/ }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'A Paper Without A PDF' })).toBeVisible()
  await expect(page.getByText(/No full text is available for this paper/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open PDF' })).toHaveCount(0)

  await page.goBack()
  await expect(page.getByRole('searchbox')).toHaveValue('LLM code repair')
  await expect(page.getByText(/2 results for “LLM code repair”/)).toBeVisible()
})
