# AI Research Assistant

A web app for finding, organizing, and understanding research papers. Search public paper databases, save papers to a local library, upload your own PDFs, and use an LLM to summarize papers and answer questions about them, grounded in each paper's full text.

Built for CS593-ASE HW1 using Claude Code (Opus 5.5) as the coding agent.

## Features

| Feature | How it works |
| --- | --- |
| **Search papers** | Queries [Semantic Scholar](https://api.semanticscholar.org/) and falls back to the [arXiv API](https://info.arxiv.org/help/api/) if Semantic Scholar is rate-limited or down. Results show title, authors, year, abstract, and links to the paper and its PDF. |
| **Save to library** | Saved papers are stored in a local SQLite database (`backend/data/papers.db`), so they persist across page refreshes and server restarts. When a paper has an open-access PDF (always true for arXiv), it is downloaded and its full text extracted at save time. |
| **Upload PDFs** | Drag a PDF onto the Library page. The backend extracts the text with PyMuPDF, then asks the LLM to pull out the title, authors, year, and abstract from the first pages. If the LLM is unavailable, layout heuristics (largest-font title, "Abstract" section, arXiv ID → year) fill in. |
| **Summarize** | Sends the paper's full text to the LLM for a structured summary (TL;DR, problem, approach, datasets, results, limitations). Summaries are cached in the database. |
| **Ask questions** | A per-paper chat. The paper's full text is the system context, prior turns are included for follow-ups, and the history is saved. Suggested questions are one click away. |
| **Browse & manage** | Filter the library by title/author/abstract, open a paper's stored PDF, remove papers. |

Papers saved without an available PDF are marked **Abstract only**. Their summaries and answers use the abstract, and the UI says so.

## Architecture

```
frontend/  React + TypeScript (Vite)          backend/  Python FastAPI
  src/pages/SearchPage.tsx   ─┐                 app/routes/search.py  → app/search.py  (Semantic Scholar, arXiv)
  src/pages/LibraryPage.tsx   ├─ /api (proxy) ─▶ app/routes/papers.py  → app/pdf.py     (PyMuPDF)
  src/pages/PaperPage.tsx    ─┘                 app/routes/ai.py      → app/llm.py     (OpenAI-compatible LLM)
  src/library.tsx  (shared library state)       app/models.py + app/db.py  → SQLite (data/papers.db)
  src/api/client.ts (typed API calls)           data/uploads/  stored PDFs
```

- **Frontend**: React 19 + TypeScript, React Router, `react-markdown` for LLM output. The Vite dev server proxies `/api` to the backend.
- **Backend**: FastAPI + SQLModel (SQLite). Tables: `paper` (metadata, extracted full text, cached summary) and `chatmessage` (Q&A history per paper).
- **LLM**: any OpenAI-compatible chat-completions API, configured in `backend/.env`. Defaults to Meta's Muse Spark. Papers fit in its ~1M-token context, so the full text is sent directly, without chunking or embeddings. A safety cap (`MAX_CONTEXT_CHARS`, default 200k chars) truncates unusually long documents.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/search?q=&limit=` | Search papers |
| GET / POST | `/api/papers` | List library / save a search result |
| POST | `/api/papers/upload` | Upload a PDF (multipart `file`) |
| GET / DELETE | `/api/papers/{id}` | Get / remove a paper |
| GET | `/api/papers/{id}/pdf` | Stored PDF |
| POST | `/api/papers/{id}/summary?regenerate=` | Generate (or return cached) summary |
| GET / POST / DELETE | `/api/papers/{id}/chat` | Q&A history / ask a question / clear |

Interactive docs are at http://localhost:8000/docs while the backend runs.

## Setup

Prerequisites: **Python 3.11+** and **Node.js 20+**.

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate      macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then edit .env and add your LLM API key
uvicorn app.main:app --reload --port 8000
```

`backend/.env` settings:

| Variable | Description |
| --- | --- |
| `LLM_BASE_URL` | OpenAI-compatible endpoint (default `https://api.meta.ai/v1`) |
| `LLM_API_KEY` | API key for that endpoint (**required** for summaries, Q&A, and LLM metadata extraction) |
| `LLM_MODEL` | Model ID (default `muse-spark-1.3`) |
| `S2_API_KEY` | Optional Semantic Scholar key. Without it, the shared rate limit often kicks in and search falls back to arXiv. |

To use a different provider, change these three `LLM_*` values. For example, OpenAI: `LLM_BASE_URL=https://api.openai.com/v1`, `LLM_MODEL=gpt-4o-mini`.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Usage

1. **Search**: enter a topic, then **Save to library** on any result.
2. **Library**: browse saved papers, or drop a PDF to upload it.
3. **Paper page**: **Summarize paper**, then ask questions in the side panel. Try the suggested questions.

## Testing

The test suite was generated and then improved over three rounds by a coding agent, for CS593 HW2. The prompts, evaluation and results are in [`docs/hw2/`](docs/hw2/).

No test calls a real LLM or paper-search API, and no test touches `backend/data/`. `backend/tests/_safety.py` is imported first by `conftest.py` and points the LLM and search settings at dummy values before the app loads, so a real key in `backend/.env` is never used.

| Layer | Framework | Location |
| --- | --- | --- |
| Backend unit + API | pytest, pytest-cov, respx | `backend/tests/test_*.py` |
| Frontend unit + component | Vitest, React Testing Library (jsdom) | `frontend/src/**/*.test.ts(x)` |
| End-to-end | Playwright (Chromium) | `frontend/e2e/*.spec.ts` |

Tests that expose a **known app bug** are kept and marked as expected failures, not deleted:
- pytest: `xfail(strict=True)`
- Vitest: `it.fails`
- Playwright: `test.fail`

Each one's reason starts with `APP BUG`. If a bug gets fixed, its test starts failing, which is the signal to remove the marker. Run `pytest --runxfail` to see the backend bug tests fail.

### Install

```bash
cd backend && pip install -r requirements-dev.txt     # inside the backend venv
cd frontend && npm install && npx playwright install chromium
```

### Run

```bash
# backend (from backend/)
python -m pytest                                    # all tests
python -m pytest --cov --cov-branch --cov-report=term-missing --cov-report=html   # + coverage (htmlcov/)

# frontend (from frontend/)
npm test                                            # Vitest
npm run test:cov                                    # + v8 coverage (coverage/)
npm run e2e                                         # Playwright E2E
```

The E2E tests start two servers themselves, so ports 8000 and 5173 must be free:
- the real backend through `backend/tests/e2e_server.py`, with the LLM, search and PDF downloads stubbed, and a throwaway temp database;
- the Vite dev server.

### Fault detection (mutation testing)

Three tiers of seeded faults, all applied to temporary copies, so the app itself is never modified:

```bash
# from the repo root, with the backend venv's python
python tools/fault_injection.py --out <dir>   # 37 hand-written faults (tools/mutants.json)
python tools/ast_mutation.py --out <dir>      # 100 tool-generated backend mutants (fixed seed)
cd frontend && npm run mutation               # StrykerJS on the frontend (reports/mutation/)
```

`tools/ast_mutation.py` finds 424 mutation sites in `backend/app` (comparison, boolean and arithmetic operator swaps, negated conditions, changed constants, `return None`, call → `pass`) and runs a fixed-seed sample of 100. Odd-numbered mutants (in both the AST and Stryker tiers) are "visible": survivors may be shown to an agent improving the tests. Even-numbered ones are "held-out" and never shown, so their score measures general improvement rather than targeting.

`python tools/collect_evidence.py <name>` runs everything (all suites, coverage, 3 shuffled-order reruns and all mutation tiers) and writes it to `docs/hw2/evidence/<name>/`.

## Notes

- `backend/.env` (secrets) and `backend/data/` (database and PDFs) are git-ignored. Never commit API keys.
- Delete `backend/data/` to reset the library.
