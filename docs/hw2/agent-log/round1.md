# Round 1: execution feedback

- **Agent:** Claude Code (Claude Opus 5.5), fresh general-purpose subagent.
- **Strategy:** execution feedback. The agent was given:
  - the round 0 test results;
  - the coverage gaps (uncovered lines and branches);
  - the independent correctness review: incorrect, weak, tautological, redundant and flaky tests.

  It was deliberately *not* given the "missing tests" list or a requirements spec; those are kept for Round 2.
- **Agent run:** 74 tool calls, ~21 minutes, ~227k tokens.

## Prompt (verbatim)

```text
You are improving an existing automated test suite in the repository at
C:\Users\cgera\Coding\Classes\CS593-ASE\ai-research-assistant (FastAPI backend in backend/app,
React frontend in frontend/src). The suite was generated in an earlier round:
backend/tests/test_*.py (+ conftest.py), frontend/src/**/*.test.ts(x) (+ src/test/mockApi.ts,
renderPage.tsx), frontend/e2e/*.ts. Read them and the application code first.

This round's strategy is EXECUTION FEEDBACK. Here are the results of running the suite and an
independent review of the tests.

== Test execution results ==
- pytest: 165 passed, 3 xfailed (strict) in 10.6s
- vitest: 98 passed
- playwright: 8 passed
- 3 extra runs of each unit suite in shuffled order: all passed

== Coverage ==
Backend (pytest-cov, branch): 99.7% lines, 100% branches. Only miss: app/routes/papers.py line 78
(the `except pdf.PDFError` -> 400 in upload_paper).
Frontend (v8): 100% lines, 98.1% branches. Uncovered branches: LibraryPage.tsx line 31,
SearchPage.tsx lines 38 and 101.

== Reviewer findings about the existing tests ==
| # | Category | Test | Problem |
|---|---|---|---|
| 1 | Incorrect expectation | PaperPage.test.tsx "shows an error if chat history cannot be loaded" | Asserts a history-LOAD failure shows "Couldn't get an answer: ..." - misleading, no question was asked. The test enshrines a UX bug as correct. |
| 2 | Incorrect expectation | PaperPage.test.tsx "shows an error for a non-numeric paper id" | Accepts that /papers/abc requests /api/papers/NaN and shows "422 Unprocessable Entity". |
| 3 | Incorrect expectation | client.test.ts "falls back to status and status text when detail is not a string" | Treats discarding FastAPI's validation detail[].msg as correct; users see a generic status line for every 422. |
| 4 | Dead path | test_pdf.py::test_heuristic_metadata_year_falls_back_to_creation_date | Uses unrealistic "2018-03-05"; real PDFs store "D:2018...". False coverage of a broken branch. |
| 5 | Questionable expectation | test_search.py::test_search_papers_falls_back_on_malformed_s2_payload | Locks in that one S2 item lacking paperId discards all S2 results. |
| 6 | Questionable expectation | test_search.py::test_arxiv_query_builder (`C++ !!` -> `all:C`) | Locks in a degraded query. |
| 7 | Weak | e2e/paper-ai.spec.ts regenerate step | Fake LLM returns the same summary, so Regenerate could be a no-op and the test still passes. |
| 8 | Weak | test_pdf.py::test_heuristic_metadata_abstract_capped_at_3000_chars | `len <= 3000` passes even if badly truncated. |
| 9 | Weak | test_api_papers.py::test_get_pdf_unknown_paper_404, test_delete_unknown_paper_404 | Status-only assertions. |
| 10 | Weak | PaperPage.test.tsx "asks a typed question..." scrollIntoView assertion | Already fires on mount; vacuous. |
| 11 | Weak/redundant | library.test.tsx "renders its children" | Only checks fetch was called. |
| 12 | Tautological | test_llm.py::test_summarize_sends_system_prompt_and_paper_context | Expected value built with the code under test (llm._paper_context). |
| 13 | Impl-coupled | test_api_papers.py::test_upload_size_limit_is_50_mb; test_upload_rejects_oversized_pdf | Pins a constant; asserts "50 MB" text while the limit is patched to ~1 KB. |
| 15 | Redundant | test_api_search.py::test_to_read_hides_full_text_and_reports_pdf; test_llm.py::test_chat_without_api_key_raises_llm_error; test_llm.py::test_summarize_truncates_huge_papers; test_pdf.py::test_extract_text_rejoins_hyphenated_line_breaks | Each duplicates another test. |
| 16 | Flaky risk | e2e `page.once('dialog', d => { expect(...); d.accept() })` | If the expect fails the dialog is never accepted and the test hangs to timeout. |
| 17 | Flaky risk | e2e DB reset via the API under test | A broken DELETE cascades into every e2e test. |
| 18 | Minor flaky | mockApi.ts module-global nextId; test_search.py no_sleep patches global asyncio.sleep | Order-dependent ids; over-broad patch. |

== What to do ==
1. Fix every finding above. Judge against the application's INTENDED behavior (README, endpoint
   contracts, obvious UX intent), not merely what the code does now. Where a test currently
   enshrines behavior that is actually wrong (findings 1-6), rewrite it to assert the correct
   behavior; if the application fails it, keep the test and mark it as a known app bug:
   pytest `@pytest.mark.xfail(strict=True, reason="APP BUG: ...")`, Vitest `it.fails(...)` with
   an `// APP BUG:` comment, Playwright `test.fail()` with a comment.
2. Strengthen weak assertions (check exact status AND body/detail, DB state, request args).
   Remove or merge redundant tests; quality over quantity.
3. Cover the uncovered branches listed above where they are reachable.
4. Do not modify application code (backend/app, non-test files in frontend/src), the test
   configs, backend/tests/_safety.py or backend/tests/e2e_server.py. You MAY reset e2e state
   some other way (e.g. a helper in frontend/e2e) as long as you don't edit those files.
5. Run all three suites (pytest from backend/ with backend/.venv/Scripts/python.exe -m pytest;
   `npx vitest run` and `npx playwright test` in frontend/). All must exit 0, with app bugs
   expressed only as strict xfail / it.fails / test.fail.

Report: a per-finding table of what you changed (or why you didn't), any new app bugs you
identified (test name + incorrect behavior + file:line), final counts for each suite, and the
number of tests added/removed.
```

## Agent's final report (verbatim)

```text
All three suites pass (exit 0), and every app bug is recorded only as a strict xfail or `it.fails`. Before marking each new one, I flipped it to a normal test and confirmed it fails at the intended assertion. Coverage is now 100% lines and branches on both backend and frontend. I changed only test files and frontend/e2e/helpers.ts. Nothing is committed. There is an untracked file `docs/hw2/agent-log/round2-spec.md` that I didn't create and left alone.

## Final counts
| Suite | Before | After |
|---|---|---|
| pytest | 165 passed, 3 xfailed | **160 passed, 7 xfailed** (strict) |
| vitest | 98 passed | **97 passed, 4 expected fail** (`it.fails`) |
| playwright | 8 passed | **9 passed** (no `test.fail` needed) |

I re-ran each unit suite 3 times in shuffled order with the round-0 seeds. All 6 runs passed.

**Tests added / removed: 11 added, 8 removed.** Backend: +6 / −7. Vitest: +4 / −1. E2E: +1 / −0. Tests rewritten in place are not counted.

## Per-finding changes
| # | What I did |
|---|---|
| 1 | Rewrote as `it.fails` "says the Q&A history could not be loaded when loading it fails". It checks the message does not say "Couldn't get an answer" and does mention loading the history. |
| 2 | Rewrote as `it.fails` "rejects a non-numeric paper id without requesting /api/papers/NaN". It checks the error view appears, no paper request is made, and no raw "422/Unprocessable/NaN" text is shown. The mock returns the real FastAPI 422 body. |
| 3 | Rewrote as `it.fails` "shows the messages from a FastAPI validation error (detail list)", which expects the `detail[].msg` text. Added a passing test: a JSON error body without `detail` falls back to the status line (504 from a gateway). |
| 4 | Deleted the `"2018-03-05"` creation-date test; the existing strict xfail with the real `D:2018…` format covers that behaviour. `text_year_beats_creation_date` now uses the real format. |
| 5 | Split into two tests. Passing: a non-JSON S2 response falls back to arXiv. Strict xfail `test_one_malformed_s2_item_does_not_discard_the_other_results`. |
| 6 | Removed the `C++ !! → all:C` case. Added strict xfail `test_arxiv_query_keeps_symbols_that_are_part_of_a_term` for `C++` and `C#`. |
| 7 | New e2e test "regenerate asks the backend for a fresh summary and shows it". `page.route` lets the request reach the real backend and records the response, holds it so the disabled "Regenerating…" button can be checked, then gives the page a recognisably changed summary that the UI must display. A no-op button or `regenerate=false` now fails the test. |
| 8 | Uses 800 distinct tokens and asserts `abstract == " ".join(tokens)[:3000]` and `len == 3000`. |
| 9 | Both 404 tests now assert `{"detail": "Paper not found"}`. The delete test also checks that an existing paper, its chat messages and its file are untouched. Other status-only tests got the same treatment (422 `loc`, nothing written to the DB, second-delete detail). |
| 10 | The scroll mock is cleared just before the answer resolves; the test then asserts a smooth scroll to the end marker. |
| 11 | Removed "renders its children". |
| 12 | The expected user message is now a literal string; the system prompt is checked for the six README section headings. |
| 13 | Removed the constant-pinning test. The oversized test now uses the real limit: 50 MiB + 1 byte gives 413 with `{"detail":"PDF is larger than 50 MB"}`, with no file, DB row or LLM call. Added a parametrized boundary test with a patched limit (at limit 201, one byte over 413). |
| 15 | Removed all 4 duplicate tests. |
| 16 | New helper `answerNextDialog(page, action)` in e2e/helpers.ts accepts or dismisses the dialog first and records its message; specs check the message afterwards with `expect.poll`. |
| 17 | `resetLibrary` no longer calls DELETE. It finds the live `ra-e2e-*/e2e.db` in the temp dir, clears `chatmessage` and `paper` with `node:sqlite`, removes uploaded files, then confirms the API lists nothing. |
| 18 | `mockApi.ts` restarts auto ids at 1000 before each test. `no_sleep` now replaces only `app.search`'s reference to asyncio. |

**Uncovered branches:**
- **SearchPage.tsx:101** (result with null `external_id`): covered by a new listing/saving test.
- **LibraryPage.tsx:31**: covered by a new test where the user leaves the page while an upload is still running.
- **SearchPage.tsx:38** (whitespace-only submit): unreachable in a real browser because the button is disabled; covered with a forced `fireEvent.submit`.
- **papers.py:78** (`except PDFError`): no real input reaches it today, because pymupdf errors escape unwrapped. Covered with a test that patches `heuristic_metadata` to raise `PDFError`.

## New app bugs found this round
1. **`test_api_papers.py::test_upload_password_protected_pdf_returns_400`** (strict xfail): uploading an encrypted PDF returns **500**. `heuristic_metadata` raises a bare `ValueError("document closed or encrypted")` (app/pdf.py:44-48), and `upload_paper` only catches `PDFError` (app/routes/papers.py:77).
2. **`SearchPage.test.tsx` "marks a result without an external id as saved after saving it"** (`it.fails`): after a successful save, a result with no `external_id` still shows "Save to library", so each click adds another copy (src/pages/SearchPage.tsx:116). This is latent: neither provider currently returns a null id.
3. **`test_search.py::test_arxiv_query_keeps_symbols_that_are_part_of_a_term[C# compilers-C#]`** (strict xfail): `C#` also becomes `all:C` (app/search.py:114-115).
```

## Developer verification
- **Protected files:** `git diff` on app code, configs, `_safety.py` and `e2e_server.py` is empty, and the real `backend/data/papers.db` is byte-identical to the backup.
- **Backend bug tests:** `pytest --runxfail` gives exactly 7 failures, which are the 7 strict-xfail tests. Each one fails for the stated reason.
- **Concern with finding 17:** the E2E reset now edits the shim's SQLite file directly. It locates the file by scanning the temp dir for `ra-e2e-*`, which is fragile. This is a consequence of my instruction not to edit `e2e_server.py`; a cleaner fix would be a test-only reset endpoint in the shim.
- **Frontend bug tests:** I flipped all 4 `it.fails` tests to plain `it` in a temporary copy. Each failed at the intended assertion:
  - `client.test.ts`: received "422 Unprocessable Entity", but expected "Input should be a valid integer".
  - `PaperPage.test.tsx` (NaN id): the page requested `GET /api/papers/NaN`.
  - `PaperPage.test.tsx` (history load): the page showed "Couldn't get an answer: chat db error".
  - `SearchPage.test.tsx` (null external id): no "Open in library" link appeared after saving.
- **Measured side effect:** removing the "unrealistic" creation-date test (finding 4) cost two backend AST mutants, A036 and A039, which were killed in round 0 and survive in round 1. The only remaining test of that code is a strict xfail. An xfail is *expected* to fail, so it cannot detect a mutant, and the creation-date fallback is now effectively untested.
