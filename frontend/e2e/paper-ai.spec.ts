import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { answerNextDialog, resetLibrary } from './helpers'

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
  await expect(page.getByRole('button', { name: 'Summarize paper' })).toHaveCount(0)
})

test('regenerate asks the backend for a fresh summary and shows it', async ({ page, request }) => {
  const first = await request.post(`/api/papers/${paperId}/summary`)
  expect(first.status()).toBe(200)
  const cached = ((await first.json()) as { summary: string }).summary

  // The stub LLM always writes the same summary, so a no-op Regenerate would look identical.
  // Let the request reach the real backend, record what it answered, hold the response so the
  // in-flight state is observable, then hand the page a recognisably different summary: the UI
  // must replace the old summary with whatever the regenerate call returns.
  const backend: { status: number; body: string }[] = []
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(
    (url) => url.pathname === `/api/papers/${paperId}/summary` && url.searchParams.get('regenerate') === 'true',
    async (route) => {
      const response = await route.fetch()
      const body = await response.text()
      backend.push({ status: response.status(), body })
      await held
      try {
        const { summary } = JSON.parse(body) as { summary: string }
        await route.fulfill({ response, json: { summary: summary.replace('E2E fake summary', 'Regenerated E2E summary') } })
      } catch {
        await route.fulfill({ response }) // pass anything unexpected through untouched
      }
    },
  )

  await page.goto(`/papers/${paperId}`)
  await expect(page.getByText('E2E fake summary of the paper.')).toBeVisible()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(page.getByRole('button', { name: 'Regenerating…' })).toBeDisabled()
  // The page still shows the old summary while waiting; only one regenerate request was sent.
  await expect(page.getByText('E2E fake summary of the paper.')).toBeVisible()
  await expect
    .poll(() => backend.map(({ status, body }) => ({ status, json: JSON.parse(body) as unknown })))
    .toEqual([{ status: 200, json: { summary: cached } }])
  release()

  await expect(page.getByText('Regenerated E2E summary of the paper.')).toBeVisible()
  await expect(page.getByText('E2E fake summary of the paper.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
  expect(backend).toHaveLength(1)
})

test('ask questions, keep history across reloads, then clear it', async ({ page, request }) => {
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

  const dialog = answerNextDialog(page, 'accept')
  await chat.getByRole('button', { name: 'Clear' }).click()
  await expect.poll(() => dialog).toEqual(['Clear this Q&A history?'])
  await expect(chat.locator('.msg')).toHaveCount(0)
  expect(await (await request.get(`/api/papers/${paperId}/chat`)).json()).toEqual([])
  await expect(chat.getByText('Ask anything, or start with one of these:')).toBeVisible()

  await page.reload()
  await expect(chat.getByText('Ask anything, or start with one of these:')).toBeVisible()
})

/** Opens the paper with one Q&A pair, then clicks Clear while the server fails the DELETE. */
async function clearChatWhileServerFails(page: Page, request: APIRequestContext) {
  expect((await request.post(`/api/papers/${paperId}/chat`, { data: { question: 'Seeded question?' } })).status()).toBe(200)
  await page.route(`**/api/papers/${paperId}/chat`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, json: { detail: 'database is locked' } })
      : route.fallback(),
  )
  await page.goto(`/papers/${paperId}`)
  const chat = page.getByRole('complementary', { name: 'Questions about this paper' })
  await expect(chat.locator('.msg')).toHaveCount(2)

  const dialog = answerNextDialog(page, 'accept')
  const failed = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().endsWith(`/api/papers/${paperId}/chat`))
  await chat.getByRole('button', { name: 'Clear' }).click()
  expect((await failed).status()).toBe(500)
  await expect.poll(() => dialog).toEqual(['Clear this Q&A history?'])
  return chat
}

test('a failed clear keeps the Q&A history on screen and on the server', async ({ page, request }) => {
  const chat = await clearChatWhileServerFails(page, request)
  await expect(chat.locator('.msg')).toHaveCount(2)
  await expect(chat.getByText('E2E fake answer to: Seeded question?')).toBeVisible()
  expect(await (await request.get(`/api/papers/${paperId}/chat`)).json()).toHaveLength(2)
})

test('a failed clear tells the user it failed', async ({ page, request }) => {
  // APP BUG: ChatPanel.clear (src/pages/PaperPage.tsx:174-178) awaits api.clearChat without a
  // try/catch, so the error becomes an unhandled promise rejection and the user sees nothing.
  test.fail()
  await clearChatWhileServerFails(page, request)
  await expect(page.getByText(/database is locked/)).toBeVisible({ timeout: 2_000 })
})

test('opening a paper that does not exist shows an error', async ({ page }) => {
  await page.goto('/papers/999999')
  await expect(page.getByText("Couldn't open this paper: Paper not found")).toBeVisible()
  await page.getByRole('link', { name: 'Back to library' }).click()
  await expect(page).toHaveURL(/\/library$/)
})
