// Capture report screenshots for the HW2 write-up with Playwright's Chromium.
//
//   NODE_PATH=frontend/node_modules node tools/screenshots.cjs reports round0 [round1 ...]
//   NODE_PATH=frontend/node_modules node tools/screenshots.cjs app        (needs e2e servers up)
//
// "reports": coverage / mutation / Playwright HTML reports and the tail of each terminal log,
// rendered as terminal-style images, for every listed round.
// "app": the running app (backend/tests/e2e_server.py + vite dev), including UI-visible bugs.
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require('@playwright/test')

const ROOT = path.resolve(__dirname, '..')
const EVIDENCE = path.join(ROOT, 'docs', 'hw2', 'evidence')
const SHOTS = path.join(EVIDENCE, 'screenshots')

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// Strip ANSI colour codes some tools emit even with NO_COLOR set.
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

function terminalHtml(title, text) {
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#1e1e1e;font:13px/1.45 Consolas,'Cascadia Mono',monospace;color:#d4d4d4}
    .bar{background:#323233;color:#ccc;padding:6px 12px;font-family:Segoe UI,sans-serif;font-size:12px}
    pre{margin:0;padding:12px 16px;white-space:pre-wrap;word-break:break-word}
    .ok{color:#89d185}.bad{color:#f48771}.warn{color:#cca700}</style>
    <div class="bar">${esc(title)}</div><pre>${esc(text)
      .replace(/^(.*\b(passed|PASSED|✓)\b.*)$/gm, '<span class="ok">$1</span>')
      .replace(/^(.*\b(XFAIL|xfailed|expected fail)\b.*)$/gm, '<span class="warn">$1</span>')
      .replace(/^(.*\b(FAILED|failed|×)\b.*)$/gm, '<span class="bad">$1</span>')}</pre>`
}

function tail(file, n, filter) {
  let lines = plain(fs.readFileSync(file, 'utf8')).split(/\r?\n/)
  if (filter) lines = lines.filter(filter)
  return lines.slice(-n).join('\n').trim()
}

async function shot(page, url, out, { fullPage = false, width = 1280, height = 800, wait = 500 } = {}) {
  await page.setViewportSize({ width, height })
  await page.goto(url)
  await page.waitForTimeout(wait)
  await page.screenshot({ path: out, fullPage })
  console.log('  ', path.relative(ROOT, out))
}

async function terminal(page, title, text, out) {
  const tmp = path.join(SHOTS, '_term.html')
  fs.writeFileSync(tmp, terminalHtml(title, text))
  await page.setViewportSize({ width: 1100, height: 200 })
  await page.goto(pathToFileURL(tmp).href)
  await page.locator('body').screenshot({ path: out })
  fs.unlinkSync(tmp)
  console.log('  ', path.relative(ROOT, out))
}

async function reports(page, round) {
  const dir = path.join(EVIDENCE, round)
  const o = (name) => path.join(SHOTS, `${round}-${name}.png`)
  console.log(round)
  await shot(page, pathToFileURL(path.join(dir, 'backend-htmlcov', 'index.html')).href, o('backend-coverage'), { height: 620 })
  await shot(page, pathToFileURL(path.join(dir, 'frontend-coverage', 'index.html')).href, o('frontend-coverage'), { height: 560 })
  if (fs.existsSync(path.join(dir, 'stryker.html')))
    await shot(page, pathToFileURL(path.join(dir, 'stryker.html')).href, o('stryker'), { height: 900, wait: 2500 })
  if (fs.existsSync(path.join(dir, 'e2e-report', 'index.html')))
    await shot(page, pathToFileURL(path.join(dir, 'e2e-report', 'index.html')).href, o('e2e-report'), { height: 700, wait: 1500 })

  const py = path.join(dir, 'backend-tests.txt')
  await terminal(page, `${round}: backend pytest (summary)`,
    tail(py, 14, (l) => /^(XFAIL|FAILED|ERROR|=+ .*(passed|failed))/.test(l)), o('term-pytest'))
  await terminal(page, `${round}: backend coverage (pytest-cov, branch)`,
    plain(fs.readFileSync(py, 'utf8')).split(/\r?\n/).filter((l) => /^(Name|---|app\\|TOTAL)/.test(l)).join('\n'), o('term-pytest-cov'))
  await terminal(page, `${round}: frontend vitest`,
    tail(path.join(dir, 'frontend-tests.txt'), 6, (l) => /Test Files|Tests |Duration|Start at/.test(l)), o('term-vitest'))
  if (fs.existsSync(path.join(dir, 'e2e-tests.txt')))
    await terminal(page, `${round}: Playwright E2E`,
      tail(path.join(dir, 'e2e-tests.txt'), 16, (l) => /✓|✘|passed|failed|flaky|Running/.test(l)), o('term-e2e'))
  for (const [file, json, label] of [['mutation-run.txt', 'mutation.json', 'hand-seeded faults'],
                                     ['mutation-ast-run.txt', 'mutation-ast.json', 'backend AST mutants (seed 593, 100 of 424 sites)']]) {
    const f = path.join(dir, file)
    if (!fs.existsSync(f)) continue
    const { summary } = JSON.parse(fs.readFileSync(path.join(dir, json), 'utf8'))
    const survivors = plain(fs.readFileSync(f, 'utf8')).split(/\r?\n/).filter((l) => /\b(survived|timeout)\b/.test(l))
    const score = ['visible', 'held-out', 'all']
      .map((k) => `${k}: ${summary[k].killed}/${summary[k].total} killed (${summary[k].score}%)`).join('   ')
    await terminal(page, `${round}: ${label}`,
      `${survivors.length ? survivors.join('\n') : '(no surviving mutants)'}\n\n${score}`, o(file.replace('-run.txt', '')))
  }
}

async function app(page) {
  const base = 'http://localhost:5173'
  const api = 'http://127.0.0.1:8000'
  const o = (name) => path.join(SHOTS, `app-${name}.png`)
  console.log('app')
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.goto(`${base}/?q=transformers`)
  await page.getByText('Attention Is All You Need').first().waitFor()
  await page.screenshot({ path: o('search') }); console.log('  ', o('search'))

  // Save both results, then open the one with a PDF and exercise summary + chat.
  const save = page.getByRole('button', { name: /save to library/i })
  while (await save.count()) {
    await save.first().click() // the clicked button turns into "Saved", so re-query each time
    await page.waitForTimeout(800)
  }
  await page.goto(`${base}/library`)
  await page.waitForTimeout(800)
  await page.screenshot({ path: o('library') }); console.log('  ', o('library'))

  const papers = await (await page.request.get(`${api}/api/papers`)).json()
  const withPdf = papers.find((p) => p.has_pdf) ?? papers[0]
  await page.goto(`${base}/papers/${withPdf.id}`)
  await page.getByRole('button', { name: /summar/i }).first().click()
  await page.getByText('E2E fake summary').first().waitFor()
  const q = page.locator('#question')
  await q.fill('What datasets are used?')
  await q.press('Enter')
  await page.getByText(/E2E fake answer/).first().waitFor()
  await page.screenshot({ path: o('paper'), fullPage: true }); console.log('  ', o('paper'))

  // UI-visible bug: a non-numeric paper id surfaces a raw 422 instead of "not found".
  await page.goto(`${base}/papers/abc`)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: o('bug-nan-id'), clip: { x: 0, y: 0, width: 1000, height: 240 } })
  console.log('  ', o('bug-nan-id'))
}

;(async () => {
  const [mode, ...rounds] = process.argv.slice(2)
  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 1.5 })
  try {
    if (mode === 'reports') for (const r of rounds) await reports(page, r)
    else if (mode === 'app') await app(page)
    else if (mode === 'term') {
      const [title, file, name] = rounds // render any text file as a terminal-style image
      await terminal(page, title, fs.readFileSync(file, 'utf8').trim(), path.join(SHOTS, `${name}.png`))
    } else throw new Error('usage: screenshots.cjs reports <round...> | app | term <title> <file> <name>')
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
