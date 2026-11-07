import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { APIRequestContext, Page } from '@playwright/test'

// backend/tests/e2e_server.py keeps its SQLite DB and uploads in tempfile.mkdtemp(prefix="ra-e2e-").
// Earlier runs leave stale directories behind, so the live one is identified by its contents.
function e2eDataDirs(): string[] {
  const roots = new Set(
    [process.env.TMPDIR, process.env.TEMP, process.env.TMP, os.tmpdir()]
      .filter((d): d is string => !!d && fs.existsSync(d))
      .map((d) => path.resolve(d)),
  )
  const dirs: string[] = []
  for (const root of roots) {
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name)
      if (name.startsWith('ra-e2e-') && fs.existsSync(path.join(dir, 'e2e.db'))) dirs.push(dir)
    }
  }
  const mtime = (d: string) => fs.statSync(path.join(d, 'e2e.db')).mtimeMs
  return dirs.sort((a, b) => mtime(b) - mtime(a)) // newest first
}

function paperIdsIn(dbFile: string): number[] {
  const db = new DatabaseSync(dbFile, { readOnly: true })
  try {
    return (db.prepare('SELECT id FROM paper ORDER BY id').all() as { id: number }[]).map((r) => r.id)
  } catch {
    return [] // not initialised yet / not our schema
  } finally {
    db.close()
  }
}

async function listedPaperIds(request: APIRequestContext): Promise<number[]> {
  const res = await request.get('/api/papers')
  if (res.status() !== 200) throw new Error(`resetLibrary: GET /api/papers returned ${res.status()}`)
  return ((await res.json()) as { id: number }[]).map((p) => p.id).sort((a, b) => a - b)
}

/**
 * Empty the library so each test starts from a clean state (the E2E backend is shared).
 *
 * Clears the E2E server's SQLite tables directly instead of calling DELETE /api/papers/{id}, so
 * a bug in the delete endpoint shows up in the test that covers it rather than in every test's
 * setup. The read-only list endpoint is only used to find the live database and to verify.
 */
export async function resetLibrary(request: APIRequestContext) {
  const ids = await listedPaperIds(request)
  if (ids.length === 0) return

  const key = ids.join(',')
  const dir = e2eDataDirs().find((d) => paperIdsIn(path.join(d, 'e2e.db')).join(',') === key)
  if (!dir) throw new Error(`resetLibrary: no ra-e2e-* database in the temp dir holds papers [${key}]`)

  const db = new DatabaseSync(path.join(dir, 'e2e.db'))
  try {
    db.exec('PRAGMA busy_timeout = 5000; BEGIN; DELETE FROM chatmessage; DELETE FROM paper; COMMIT;')
  } finally {
    db.close()
  }
  const uploads = path.join(dir, 'uploads')
  for (const f of fs.existsSync(uploads) ? fs.readdirSync(uploads) : []) fs.rmSync(path.join(uploads, f), { force: true })

  const left = await listedPaperIds(request)
  if (left.length) throw new Error(`resetLibrary: library still lists papers [${left.join(',')}] after reset`)
}

/**
 * Answer the next dialog (confirm/alert) right away, then record its message.
 * Assert on the returned array afterwards (e.g. with expect.poll): never call expect() inside the
 * handler, or a failed expectation would leave the dialog open and hang the test until timeout.
 */
export function answerNextDialog(page: Page, action: 'accept' | 'dismiss'): string[] {
  const messages: string[] = []
  page.once('dialog', (dialog) => {
    void (action === 'accept' ? dialog.accept() : dialog.dismiss())
    messages.push(dialog.message())
  })
  return messages
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
