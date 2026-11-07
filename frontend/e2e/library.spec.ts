import { expect, test } from '@playwright/test'
import { answerNextDialog, makePdf, papers, resetLibrary } from './helpers'

test.beforeEach(async ({ request }) => {
  await resetLibrary(request)
})

test('upload a PDF, land on its page, and open the stored PDF', async ({ page, request }) => {
  await page.goto('/library')
  await expect(page.getByText(/Your library is empty/)).toBeVisible()

  await page.locator('input[type="file"]').setInputFiles({
    name: 'uploaded-paper.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf('Neural Widgets At Scale'),
  })

  // The fake LLM returns no metadata, so the title comes from the PDF layout heuristics.
  await expect(page.getByRole('heading', { level: 1, name: 'Neural Widgets At Scale' })).toBeVisible()
  await expect(page).toHaveURL(/\/papers\/\d+$/)
  const id = page.url().split('/').pop()
  await expect(page.getByText(/written from the paper's full text/)).toBeVisible()
  const pdfLink = page.getByRole('link', { name: 'Open PDF' })
  await expect(pdfLink).toHaveAttribute('href', `/api/papers/${id}/pdf`)

  const pdf = await request.get(`/api/papers/${id}/pdf`)
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toBe('application/pdf')
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')

  await page.getByRole('link', { name: 'Library' }).first().click()
  const item = papers(page).filter({ hasText: 'Neural Widgets At Scale' })
  await expect(item).toBeVisible()
  await expect(item.getByText('Uploaded PDF')).toBeVisible()
})

test('rejects non-PDF uploads on the client and on the server', async ({ page }) => {
  await page.goto('/library')
  const input = page.locator('input[type="file"]')

  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(page.getByText("Upload failed: notes.txt isn't a PDF. Choose a .pdf file.")).toBeVisible()

  // Named .pdf but not actually a PDF: the backend refuses it.
  await input.setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') })
  await expect(page.getByText('Upload failed: File is not a PDF')).toBeVisible()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByText(/Your library is empty/)).toBeVisible()
})

test('filter the library and remove a paper', async ({ page, request }) => {
  for (const [i, title] of ['Graph Neural Networks', 'Vision Transformers', 'Diffusion Policies'].entries()) {
    const res = await request.post('/api/papers', {
      data: { source: 'arxiv', external_id: `e2e:${i}`, title, authors: [`Author ${i}`], abstract: `About ${title}.` },
    })
    expect(res.status()).toBe(201)
  }
  await page.goto('/library')
  await expect(page.getByText('3 of 3 papers')).toBeVisible()

  await page.getByRole('searchbox', { name: 'Filter library' }).fill('transformers')
  await expect(page.getByText('1 of 3 papers')).toBeVisible()
  await expect(papers(page)).toHaveCount(1)
  await expect(papers(page)).toContainText('Vision Transformers')

  await page.getByRole('searchbox', { name: 'Filter library' }).fill('')
  await expect(papers(page)).toHaveCount(3)

  // Dismissing the confirmation keeps the paper.
  const target = papers(page).filter({ hasText: 'Diffusion Policies' })
  const confirmText = 'Remove “Diffusion Policies” from your library? Its summary and Q&A history will be deleted.'
  const dismissed = answerNextDialog(page, 'dismiss')
  await target.getByRole('button', { name: 'Remove' }).click()
  await expect.poll(() => dismissed).toEqual([confirmText])
  await expect(papers(page)).toHaveCount(3)
  expect(await (await request.get('/api/papers')).json()).toHaveLength(3) // nothing deleted server-side

  const accepted = answerNextDialog(page, 'accept')
  await target.getByRole('button', { name: 'Remove' }).click()
  await expect.poll(() => accepted).toEqual([confirmText])
  await expect(page.getByText('2 of 2 papers')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByLabel('2 papers')).toBeVisible()

  await page.reload()
  await expect(papers(page).filter({ hasText: 'Diffusion Policies' })).toHaveCount(0)
  await expect(papers(page)).toHaveCount(2)
})
