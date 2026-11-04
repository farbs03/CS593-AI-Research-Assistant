import { expect, test } from '@playwright/test'
import { resetLibrary } from './helpers'

const SAVED_PAPER = {
  source: 'semantic_scholar',
  external_id: 'arxiv:1706.03762',
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'],
  year: 2017,
  abstract: 'The dominant sequence transduction models are based on complex recurrent networks.',
  url: 'https://arxiv.org/abs/1706.03762',
  pdf_url: 'https://arxiv.org/pdf/1706.03762',
}

let paperId: number

test.beforeEach(async ({ request }) => {
  await resetLibrary(request)
  const res = await request.post('/api/papers', { data: SAVED_PAPER })
  expect(res.status()).toBe(201)
  const paper = await res.json()
  expect(paper.text_status).toBe('full')
  paperId = paper.id
})

test('summarize a paper; the summary is cached across reloads', async ({ page }) => {
  await page.goto(`/papers/${paperId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Attention Is All You Need' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', `/api/papers/${paperId}/pdf`)
  await expect(page.getByText(/written from the paper's full text/)).toBeVisible()

  await page.getByRole('button', { name: 'Summarize paper' }).click()
  await expect(page.getByRole('heading', { name: 'TL;DR' })).toBeVisible()
  await expect(page.getByText('E2E fake summary of the paper.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Limitations' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Summarize paper' })).toHaveCount(0)

  await page.reload()
  await expect(page.getByText('E2E fake summary of the paper.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(page.getByText('E2E fake summary of the paper.')).toBeVisible()
})

test('ask questions, keep history across reloads, then clear it', async ({ page }) => {
  await page.goto(`/papers/${paperId}`)
  const chat = page.getByRole('complementary', { name: 'Questions about this paper' })
  await expect(chat.getByText('Ask anything, or start with one of these:')).toBeVisible()

  await chat.getByRole('button', { name: 'What datasets are used?' }).click()
  await expect(chat.getByText('E2E fake answer to: What datasets are used?')).toBeVisible()

  const box = chat.getByRole('textbox', { name: 'Your question' })
  await box.fill('How many layers does the encoder have?')
  await box.press('Enter')
  await expect(chat.getByText('E2E fake answer to: How many layers does the encoder have?')).toBeVisible()
  await expect(box).toHaveValue('')
  await expect(chat.locator('.msg')).toHaveCount(4)

  await page.reload()
  await expect(chat.locator('.msg')).toHaveCount(4)
  await expect(chat.locator('.msg').first()).toHaveText('What datasets are used?')

  page.once('dialog', (d) => {
    expect(d.message()).toBe('Clear this Q&A history?')
    void d.accept()
  })
  await chat.getByRole('button', { name: 'Clear' }).click()
  await expect(chat.locator('.msg')).toHaveCount(0)
  await expect(chat.getByText('Ask anything, or start with one of these:')).toBeVisible()

  await page.reload()
  await expect(chat.getByText('Ask anything, or start with one of these:')).toBeVisible()
})

test('opening a paper that does not exist shows an error', async ({ page }) => {
  await page.goto('/papers/999999')
  await expect(page.getByText("Couldn't open this paper: Paper not found")).toBeVisible()
  await page.getByRole('link', { name: 'Back to library' }).click()
  await expect(page).toHaveURL(/\/library$/)
})
