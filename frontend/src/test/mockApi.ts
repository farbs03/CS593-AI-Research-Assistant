// Test helpers: a routed fetch mock (so the real api client is exercised) and data factories.
import { afterEach, beforeEach, vi } from 'vitest'
import type { ChatMessage, Paper, SearchResult } from '../types'

afterEach(() => {
  vi.unstubAllGlobals()
})

export interface Req {
  method: string
  url: string
  path: string
  search: URLSearchParams
  init?: RequestInit
  /** Parsed JSON body (undefined for non-JSON bodies such as FormData). */
  json?: unknown
}

export type Handler = (req: Req) => Response | Promise<Response> | undefined

export const jsonResponse = (body: unknown, status = 200, statusText = 'OK') =>
  new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  })

export const noContent = () => new Response(null, { status: 204, statusText: 'No Content' })

export const errorResponse = (status: number, detail: string, statusText = 'Error') =>
  jsonResponse({ detail }, status, statusText)

/** Installs a fetch mock. Unhandled requests fail the test loudly with a 599. */
export function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const parsed = new URL(url, 'http://localhost')
    let json: unknown
    if (typeof init?.body === 'string') json = JSON.parse(init.body)
    const req: Req = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      path: parsed.pathname,
      search: parsed.searchParams,
      init,
      json,
    }
    const res = await handler(req)
    if (!res) return errorResponse(599, `Unmocked request: ${req.method} ${url}`)
    return res
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Requests made to a fetch mock, as "METHOD /path?query". */
export const calls = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls.map(([input, init]) => `${((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase()} ${String(input)}`)

// Auto-assigned ids restart for every test, so a test's data never depends on which tests ran
// before it (or in what order). They start high to stay clear of the small explicit ids tests use.
const FIRST_AUTO_ID = 1000
let nextId = FIRST_AUTO_ID
beforeEach(() => {
  nextId = FIRST_AUTO_ID
})

export function makePaper(over: Partial<Paper> = {}): Paper {
  const id = over.id ?? nextId++
  return {
    id,
    source: 'arxiv',
    external_id: `arxiv:${id}`,
    title: `Paper ${id}`,
    authors: ['Ada Lovelace'],
    year: 2020,
    abstract: 'An abstract.',
    url: `https://arxiv.org/abs/${id}`,
    pdf_url: `https://arxiv.org/pdf/${id}`,
    text_status: 'full',
    summary: null,
    has_pdf: true,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

export function makeResult(over: Partial<SearchResult> = {}): SearchResult {
  return {
    source: 'semantic_scholar',
    external_id: 'arxiv:1706.03762',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    year: 2017,
    abstract: 'The dominant sequence transduction models.',
    url: 'https://arxiv.org/abs/1706.03762',
    pdf_url: 'https://arxiv.org/pdf/1706.03762',
    saved_id: null,
    ...over,
  }
}

export function makeMessage(over: Partial<ChatMessage> = {}): ChatMessage {
  const id = over.id ?? nextId++
  return {
    id,
    paper_id: 1,
    role: 'user',
    content: `message ${id}`,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

/** A promise you can resolve from the test, to observe in-flight UI states. */
export function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * A JSON response for a request the test answers late, plus `read`: a promise that settles once
 * the page has parsed the body and its own promise callbacks have run. Awaiting it (inside act)
 * lets a test check deterministically that a late response did NOT change the page.
 */
export function lateJsonResponse(body: unknown, status = 200) {
  const response = jsonResponse(body, status)
  const read = deferred<void>()
  const parse = response.json.bind(response)
  response.json = async () => {
    const parsed: unknown = await parse()
    setTimeout(read.resolve, 0) // a macrotask: runs after the page's pending microtasks
    return parsed
  }
  return { response, read: read.promise }
}
