# Round 2: requirements spec + mutation feedback

- **Agent:** Claude Code (Claude Opus 5.5), fresh general-purpose subagent.
- **Strategy:** a different kind of context from Round 1. The agent was given:
  - (A) an intended-behavior specification R1–R15, written from the README and API contract (`round2-spec.md`);
  - (B) the **visible** mutants that survived the round 1 suite. That is 13 backend AST mutants and 22 StrykerJS mutants; held-out mutants are never shown.

  The prompt also passes on one lesson from round 1's measurements: an xfail test cannot detect regressions, so a passing test should be kept for any part of a requirement that already works.
- **Agent run:** 85 tool calls, ~23 minutes, ~293k tokens.

## Prompt (verbatim)

```text
You are improving an existing automated test suite in the repository at
C:\Users\cgera\Coding\Classes\CS593-ASE\ai-research-assistant (FastAPI backend in backend/app,
React frontend in frontend/src). Tests: backend/tests/test_*.py (+ conftest.py),
frontend/src/**/*.test.ts(x) (+ src/test/*), frontend/e2e/*.ts. Read the tests and the
application code first.

This round's strategy is REQUIREMENTS + MUTATION FEEDBACK. Below is (A) a specification of the
application's intended behavior written by its developer, and (B) mutants (small artificial code
changes) that the current suite fails to detect.

== (A) Intended-behavior specification ==
## Backend API contract
- **R1. No 500s.** No request may produce a 500.
  - Client errors return 4xx with a JSON body `{"detail": "<human-readable message>"}`.
  - Failures of upstream services (the LLM, paper search) return 502 with a message.
- **R2. Consistent 404s.** Every `/api/papers/{id}...` endpoint, for every HTTP method, returns 404 "Paper not found" for an id that does not exist.
- **R3. Search.**
  - `q` must contain at least one non-whitespace character; otherwise it is rejected with 4xx.
  - Semantic Scholar is used first. arXiv is used only if Semantic Scholar is rate-limited or down (HTTP error, timeout, network error).
  - A single odd item in a provider response must not throw away the other valid results.
  - Results already in the library carry their `saved_id`.
- **R4. Upload.**
  - A non-PDF, or a file that claims to be a PDF but cannot be read, is rejected with 400 and a message.
  - A file over 50 MB is rejected with 413.
  - LLM-extracted metadata is preferred, and heuristics fill in missing fields.
  - LLM output of any shape must never corrupt metadata: `title` is a string, `authors` is a list of whole author names, and `year` is an integer or null.
- **R5. Save.**
  - Saving is idempotent by `external_id`.
  - If the PDF cannot be downloaded or is not a valid PDF, the paper is still saved as "Abstract only" with `has_pdf: false`, and no file is left behind.
- **R6. Stored PDF.** `GET /pdf` returns the PDF bytes. It returns 404 if no PDF is stored or the stored file is missing.
- **R7. Summary.**
  - Summaries are cached, and `regenerate=true` replaces the cache.
  - A summary is never empty: a blank LLM reply is treated as an LLM failure (502) and is not cached.
  - Abstract-only papers are summarized from the abstract, flagged as such.
  - Text longer than `MAX_CONTEXT_CHARS` is truncated.
- **R8. Chat.**
  - History is returned oldest-first, and prior turns are sent as context for follow-up questions.
  - A blank question returns 400.
  - An LLM failure, including a blank answer, returns 502 and saves nothing.
  - Clearing affects only that paper.
- **R9. Delete.** Deleting a paper also removes its chat history and its stored PDF file.
- **R10. Startup.** On startup, the app creates its database tables if they don't exist. `/api/health` reports the configured model and whether an LLM key is set.

## Frontend
- **R11. Error messages.** Server errors are shown to the user with the server's message, including validation (422) messages, never as a bare "422 Unprocessable Entity" when the server sent a message.
- **R12. No silent failures.** Every user action that fails shows an error message. This includes save, upload, remove, summarize, ask and clear chat. Messages say what actually failed; for example, failing to *load* chat history must not say "Couldn't get an answer".
- **R13. Search page.**
  - The query lives in the URL (`?q=`), and the search box always reflects the URL's `q`, including after browser back/forward.
  - Blank queries are not submitted.
  - Results from an older query never replace results for a newer one.
- **R14. Paper page.**
  - A paper id that is not a number shows a "not found" message, without calling the API with an invalid id.
  - Navigating from one paper to another never shows the previous paper's data.
  - Enter sends a question; Shift+Enter inserts a newline.
- **R15. Library.**
  - The filter matches title, authors or abstract, case-insensitively.
  - Upload accepts files ending in `.pdf` in any letter case, or files with the PDF MIME type. Anything else gets a message.
  - Removing a paper asks for confirmation first.

== (B) Surviving mutants ==
Each entry is a single code change that, when applied to the app, still lets every test pass.
For each one, either add/strengthen a test so that the mutant would be detected, or explain
briefly why it is equivalent (behaves identically) or not worth testing.
Backend (AST mutants; each line shows the original code and the mutant that your tests did NOT detect):
- A001 backend/app/config.py:7  `load_dotenv(BACKEND_DIR / '.env')`  ->  `pass`
- A003 backend/app/config.py:9  `'data'`  ->  `""`
- A005 backend/app/config.py:11  `'papers.db'`  ->  `""`
- A007 backend/app/config.py:15  `'muse-spark-1.3'`  ->  `""`
- A009 backend/app/db.py:13  `SQLModel.metadata.create_all(engine)`  ->  `pass`
- A011 backend/app/db.py:7  `False`  ->  `True`
- A019 backend/app/llm.py:49  `12000`  ->  `12001`
- A027 backend/app/models.py:62  `'pdf_path'`  ->  `""`
- A039 backend/app/pdf.py:59  `1`  ->  `2`
- A041 backend/app/pdf.py:70  `1`  ->  `2`
- A057 backend/app/routes/ai.py:10  `'ai'`  ->  `""`
- A079 backend/app/search.py:108  `'are'`  ->  `""`
- A081 backend/app/search.py:108  `'or'`  ->  `""`

Frontend (StrykerJS mutants that survived the Vitest suite):
- S95 frontend/src/components/PaperCard.tsx:43 StringLiteral: `' '`  ->  `""`
- S121 frontend/src/library.tsx:34 ArrayDeclaration: `[]`  ->  `["Stryker was here"]`
- S159 frontend/src/pages/LibraryPage.tsx:13 BooleanLiteral: `false`  ->  `true`
- S191 frontend/src/pages/LibraryPage.tsx:36 CallExpression: `e.preventDefault()`  ->  `;`
- S215 frontend/src/pages/LibraryPage.tsx:66 StringLiteral: `''`  ->  `"Stryker was here!"`
- S217 frontend/src/pages/LibraryPage.tsx:68 CallExpression: `e.preventDefault()`  ->  `;`
- S223 frontend/src/pages/LibraryPage.tsx:82 OptionalChaining: `inputRef.current?.click`  ->  `inputRef.current.click`
- S225 frontend/src/pages/LibraryPage.tsx:92 OptionalChaining: `e.target.files?.[0]`  ->  `e.target.files[0]`
- S237 frontend/src/pages/LibraryPage.tsx:99 ConditionalExpression: `!loading && papers.length === 0`  ->  `true`
- S267 frontend/src/pages/PaperPage.tsx:24 CallExpression: `setPaper(null)`  ->  `;`
- S271 frontend/src/pages/PaperPage.tsx:27 ArrayDeclaration: `[id]`  ->  `[]`
- S337 frontend/src/pages/PaperPage.tsx:138 ArrayDeclaration: `[]`  ->  `["Stryker was here"]`
- S343 frontend/src/pages/PaperPage.tsx:146 ArrayDeclaration: `[paperId]`  ->  `[]`
- S371 frontend/src/pages/PaperPage.tsx:170 CallExpression: `e.preventDefault()`  ->  `;`
- S397 frontend/src/pages/PaperPage.tsx:204 ConditionalExpression: `m.role === 'assistant'`  ->  `true`
- S417 frontend/src/pages/PaperPage.tsx:237 CallExpression: `e.preventDefault()`  ->  `;`
- S461 frontend/src/pages/SearchPage.tsx:31 BooleanLiteral: `true`  ->  `false`
- S489 frontend/src/pages/SearchPage.tsx:82 ConditionalExpression: `i < EXAMPLES.length - 1`  ->  `false`
- S491 frontend/src/pages/SearchPage.tsx:82 EqualityOperator: `i < EXAMPLES.length - 1`  ->  `i >= EXAMPLES.length - 1`
- S493 frontend/src/pages/SearchPage.tsx:82 StringLiteral: `', '`  ->  `""`
- S519 frontend/src/pages/SearchPage.tsx:101 LogicalOperator: `r.external_id ?? r.title`  ->  `r.external_id && r.title`
- S527 frontend/src/pages/SearchPage.tsx:120 CallExpression: `setError(null)`  ->  `;`

== What to do ==
1. Go through the specification requirement by requirement. For each one, check whether the
   suite already verifies it with a meaningful assertion; if not, write a spec-driven test
   (unit, API, component, or e2e - whichever level is most appropriate). Pay particular
   attention to error handling and edge cases (unusual LLM output shapes, missing files,
   whitespace input, out-of-order responses, browser back/forward, etc.).
2. Where the application violates the specification, keep the test and mark it as a known app
   bug: pytest `@pytest.mark.xfail(strict=True, reason="APP BUG: ...")`, Vitest `it.fails(...)`
   with an `// APP BUG:` comment, Playwright `test.fail()` with a comment. Make sure each such
   test fails for the stated reason (temporarily remove the marker and check the failure).
   Important: a test marked xfail/it.fails cannot detect future regressions, so where a
   requirement is partly met, keep a separate passing test for the part that works.
3. Address the surviving mutants in (B) as described above.
4. Keep the suite high quality: precise assertions, no redundancy, no flakiness, no real
   network/LLM calls. Do not modify application code (backend/app, non-test files in
   frontend/src), the test configs, backend/tests/_safety.py or backend/tests/e2e_server.py.
5. Run all three suites (backend: `.venv/Scripts/python.exe -m pytest` in backend/;
   frontend: `npx vitest run` and `npx playwright test` in frontend/). All must exit 0.

Report: (a) a requirement-by-requirement table R1-R15: already covered / test added / app bug
found (with test name), (b) a table of the mutants in (B): killed by which test, or why
equivalent/not worth testing, (c) every app bug you found (test name, incorrect behavior,
file:line), (d) final counts for each suite and tests added/removed.
```

## Agent's final report (abridged; tables reproduced verbatim)

### (a) Requirements R1–R15

| Req | Status | Tests |
|---|---|---|
| R1 No 500s | Bugs found | Seven new strict xfails reach a 500 (#2, #3, #4, #6, #7, #9 below, plus the 64-bit id). FastAPI's 422 sends `detail` as a list; R11 explicitly expects that, so it was not flagged as a backend bug. |
| R2 Consistent 404s | Test added, bug found | `test_every_paper_endpoint_404s_for_unknown_id`: 7 endpoint/method cases checking exact detail and that nothing changes. 6 pass; `[clear-chat]` is an xfail. `test_paper_id_beyond_64_bits_is_404` is an xfail. |
| R3 Search | Tests added, bugs found | `test_search_rejects_whitespace_only_query` (xfail). `test_search_papers_falls_back_when_s2_is_down` covers timeout, network error and 503. New passing tests: `test_search_papers_does_not_fall_back_when_s2_finds_nothing`, `test_parse_arxiv_odd_entry_does_not_discard_the_others`. `test_one_odd_s2_item_does_not_discard_the_other_results` (xfail) covers missing paperId, null item and null author. |
| R4 Upload | Test added, bugs found | `test_odd_llm_metadata_shapes_never_corrupt_metadata`: 5 shapes pass; authors as a string, a null author entry, author objects and an overflowing year are xfails. |
| R5 Save | Mostly covered, bugs found | New xfails: `test_saving_empty_external_id_twice_is_not_a_server_error`, `test_save_out_of_range_year_is_a_client_error`. |
| R6 Stored PDF | Test added, bug found | `test_get_pdf_whose_file_is_missing_404` (xfail). |
| R7 Summary | Tests added, bugs found | `test_blank_llm_summary_is_502_and_not_cached` (null and whitespace replies), `test_llm_reply_without_choices_is_502`, both xfails. |
| R8 Chat | Test added, bug found | `test_blank_llm_answer_is_502_and_nothing_saved` (xfail). |
| R9 Delete | Already covered | — |
| R10 Startup | Tests added | New `tests/test_app_setup.py` (4 tests: startup creates tables on an empty DB, a restart keeps data, `.env` is loaded, documented defaults and the `backend/data` location). `test_health_reports_configured_model_and_whether_a_key_is_set` covers key set and unset. |
| R11 Error messages | Already covered | Round 1 `it.fails` in `client.test.ts`. |
| R12 No silent failures | Tests added, bug found | e2e "a failed clear keeps the Q&A history…" (passes) and "a failed clear tells the user it failed" (`test.fail`). |
| R13 Search page | Tests added, bug found | Vitest "never lets an older query replace the results of a newer one". e2e "browser back/forward re-runs the search…" (passes) and "the search box shows the URL query after browser back" (`test.fail`). |
| R14 Paper page | Tests added, bugs found | Vitest "shows only the new paper (and its chat)…" (passes), plus two `it.fails` for late responses from the previous paper. |
| R15 Library | Tests added | `it.each` for accepted files (`Scan.PDF`, `paper.Pdf`, PDF-type file named `download`) and rejected files (`notes.txt`, `paper.pdf.txt`, `pdf`). |

### (b) Mutants

28 of the 35 listed mutants are now killed. The other 7 are equivalent or not worth testing.

**Equivalent:**
- **A027:** `PaperRead` ignores extra fields.
- **A041:** PyMuPDF always sets `dir`.
- **S121:** a constant dependency array.
- **S223:** the ref is always set.
- **S225:** a file input's change event always has a FileList.
- **S343:** ChatPanel remounts on each paper change.

**Not worth testing:**
- **A057:** an OpenAPI tag label.

The agent verified kills by applying each mutant to a temporary copy.

### (c) App bugs found this round
1. **`DELETE /api/papers/{unknown}/chat` returns 204 instead of 404** (`app/routes/ai.py:72-75`).
2. **Paper id of 2^63 → OverflowError → 500** (`app/routes/papers.py:21`).
3. **`external_id: ""` saved twice → IntegrityError → 500** (`app/routes/papers.py:49`).
4. **Year 10^20 on save → 500 instead of 4xx** (`app/models.py:18`).
5. **LLM `authors` as a string, null entry or objects** are stored as single characters, `"None"`, or a dict repr (`app/llm.py:62`).
6. **All-digit overflowing year from the LLM → 500 on upload** (`app/llm.py:63`).
7. **Stored PDF file missing → 500 instead of 404** (`app/routes/papers.py:105`).
8. **Blank LLM summary → 200 `{"summary": ""}`, cached** (`app/llm.py:34`, `app/routes/ai.py:32-37`).
9. **LLM reply without `choices` → IndexError → 500** (`app/llm.py:34`).
10. **Blank LLM answer → 200, empty assistant message saved** (`app/routes/ai.py:56-66`).
11. **One odd Semantic Scholar item (null item, null author) discards all results**, and search silently switches to arXiv (`app/search.py:47-65`). This extends the round 1 bug.
12. **Whitespace-only search query accepted** and sent to the providers (`app/routes/search.py:19`).
13. **PaperPage: a slow response for the previous paper replaces the current one** (`src/pages/PaperPage.tsx:23-27`).
14. **PaperPage: a summary finishing after navigation brings the old paper back** (`src/pages/PaperPage.tsx:79-82`).
15. **SearchPage: the search box shows a stale query after browser Back** (`src/pages/SearchPage.tsx:15`).
16. **PaperPage: a failed "Clear" shows no error**; it becomes an unhandled promise rejection (`src/pages/PaperPage.tsx:174-178`).

### (d) Final counts
| Suite | Before | After |
|---|---|---|
| pytest | 160 passed, 7 xfailed | **178 passed, 24 xfailed** (+17 test functions / +35 items; 4 status-only 404 tests merged into one cross-endpoint test) |
| vitest | 97 passed, 4 expected fail | **106 passed, 6 expected fail** (+11, none removed) |
| playwright | 9 passed | **13 passed** (2 via `test.fail`) |

## Developer verification
- **Protected files:** `git diff` on app code, configs, `conftest.py`, `_safety.py` and `e2e_server.py` is empty. The real `backend/data/papers.db` is byte-identical to the backup. The new startup test points the app at a temp DB and fails loudly if it ever connects to `backend/data/papers.db`.
- **Backend bug tests:** `pytest --runxfail` gives exactly 24 failures, which are the 24 strict-xfail items.
- **Frontend bug tests:** flipping all `it.fails` to `it` in a temporary copy gives exactly 6 failures, each at the intended assertion. For example, "Expected element to have text content: BERT / Received: Attention Is All You Need" for the stale-paper bug.
- **Critique:**
  - `test_library_is_stored_under_backend_data` kills A003/A005 just by restating config constants. It adds to the mutation score but is close to a tautology.
  - Bugs 2, 4 and 6 (64-bit id, year 10^20) and the "authors as objects" case are real R1 violations but contrived inputs with low practical severity.
