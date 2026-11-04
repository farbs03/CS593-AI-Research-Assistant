import type { APIRequestContext, Page } from '@playwright/test'

/** Remove every paper so each test starts from an empty library (the E2E backend is shared). */
export async function resetLibrary(request: APIRequestContext) {
  const res = await request.get('/api/papers')
  for (const p of (await res.json()) as { id: number }[]) {
    await request.delete(`/api/papers/${p.id}`)
  }
}

/** A tiny but valid one-page PDF whose only (large) text line is `title`, plus a body line. */
export function makePdf(title: string, body = 'Body text of an uploaded E2E paper.'): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`)
  const stream = `BT /F1 24 Tf 72 720 Td (${esc(title)}) Tj ET\nBT /F1 11 Tf 72 680 Td (${esc(body)}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** The entries of the paper list on the current page (excludes the nav rail's list items). */
export const papers = (page: Page) => page.getByRole('main').getByRole('listitem')
