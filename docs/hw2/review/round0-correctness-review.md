# Round 0: test-correctness review

**Method:** an independent read-only reviewer subagent (fresh context, not shown my own bug list) reviewed every test against the app's *intended* behavior. I then spot-checked findings #1, #8 and the missing-DELETE observation against the source, and all three were confirmed. Note that finding #14 concerns `e2e_server.py`, the E2E shim I wrote in Step 0, not agent-generated tests.

## Findings
| # | Category | Test (file::name) | Problem | Suggested fix |
|---|---|---|---|---|
| 1 | Incorrect expectation | PaperPage.test.tsx::"shows an error if chat history cannot be loaded" | Asserts that a history-load failure shows "Couldn't get an answer: …". That message is misleading, because no question was asked (PaperPage.tsx:145/224 reuse the ask-error state). | Expect a distinct "Couldn't load chat history" message. |
| 2 | Incorrect expectation | PaperPage.test.tsx::"shows an error for a non-numeric paper id" | Accepts that `/papers/abc` sends `GET /api/papers/NaN` and shows "422 Unprocessable Entity". | Expect "Paper not found"-style text and no request for a NaN id. |
| 3 | Incorrect expectation | client.test.ts::"falls back to status and status text when detail is not a string" | Treats throwing away FastAPI's validation `detail[].msg` as correct (client.ts:14). Every 422 the user sees becomes a generic status line. | Expect the first `detail[0].msg` to be shown. |
| 4 | Enshrines dead path | test_pdf.py::test_heuristic_metadata_year_falls_back_to_creation_date | Passes only because it uses an unrealistic `"2018-03-05"`. Real PDFs store `D:2018…`, which never matches. It gives false coverage of a broken branch. | Use the real format, or merge with the xfail test. |
| 5 | Questionable expectation | test_search.py::test_search_papers_falls_back_on_malformed_s2_payload | Locks in that one S2 item without `paperId` throws away all S2 results and silently switches provider. | Expect the bad item to be skipped and the other results kept. |
| 6 | Questionable expectation | test_search.py::test_arxiv_query_builder (`C++ !!`→`all:C`) | Locks in degraded queries. | Drop these cases or define the intended behavior. |
| 7 | Weak | e2e/paper-ai.spec.ts (Regenerate step) | The fake LLM always returns the same summary, so Regenerate could be a no-op and the test still passes. | Check the request URL, or vary the replies. |
| 8 | Weak | test_pdf.py::test_heuristic_metadata_abstract_capped_at_3000_chars | `len <= 3000` still passes if the abstract is badly truncated. | Assert `== 3000`. |
| 9 | Weak | test_api_papers.py::test_get_pdf_unknown_paper_404, test_delete_unknown_paper_404 | Check status only. | Also assert `detail`. |
| 10 | Weak | PaperPage.test.tsx::"asks a typed question…" (`scrollIntoView` toHaveBeenCalled) | The effect already fires on mount, so this assertion is vacuous. | Clear the mock before resolving, then assert. |
| 11 | Weak | library.test.tsx::"renders its children" | Only checks that `fetch` was called. | Remove it (redundant). |
| 12 | Tautological | test_llm.py::test_summarize_sends_system_prompt_and_paper_context | The expected value is built with the code under test (`llm._paper_context`). | Assert literal substrings. |
| 13 | Impl-coupled | test_api_papers.py::test_upload_size_limit_is_50_mb; test_upload_rejects_oversized_pdf | Pins a constant; asserts "50 MB" in the message even though the limit is patched to about 1 KB. | Derive the message from the limit, or drop the constant test. |
| 14 | Impl-coupled | backend/tests/e2e_server.py::fake_chat (my shim) | The fake picks its reply by exact prompt prefixes. | Acceptable for the E2E shim; documented. |
| 15 | Redundant | test_api_search.py::test_to_read_hides_full_text_and_reports_pdf; test_llm.py::test_chat_without_api_key_raises_llm_error; test_summarize_truncates_huge_papers; test_pdf.py::test_extract_text_rejoins_hyphenated_line_breaks | Each duplicates another test. | Merge or delete. |
| 16 | Flaky risk | e2e `page.once('dialog', d => { expect(...); d.accept() })` | If the `expect` fails, the dialog is never accepted, so the test hangs until timeout. | Capture the message, accept, assert afterwards. |
| 17 | Flaky risk | playwright.config.ts fixed ports + DB reset through the API under test | A broken DELETE cascades into every E2E test. | Reset the DB through the shim. |
| 18 | Minor flaky | mockApi.ts module-global `nextId`; test_search.py `no_sleep` patches global `asyncio.sleep` | Order-dependent ids; overly broad patch. | Reset in `beforeEach`; patch `search.asyncio.sleep`. |

## Missing tests (and how the app behaves today)
- **LLM returns `authors` as a string:** broken. `"Ada, Alan"` becomes a list of single characters (llm.py:62).
- **LLM returns a non-string `title`:** `AttributeError` instead of `LLMError` (llm.py:61).
- **LLM returns a float year (`2019.0`):** becomes None (llm.py:63).
- **Empty LLM reply:** the summary is stored as `""` and returned with 200 (ai.py:32). An empty assistant message is also saved.
- **PDF file missing on disk:** `GET /pdf` gives a 500 (papers.py:105). It should be a 404.
- **`DELETE /chat` on a nonexistent paper:** returns 204 (ai.py:72-75), which is inconsistent with GET/POST.
- **Whitespace-only `q` on the API:** passes `min_length=1` (routes/search.py:19).
- **Clear-chat failure on the frontend:** unhandled rejection, no error shown (PaperPage.tsx:174-178).
- **Back/forward between two searches:** the input doesn't sync with the URL (SearchPage.tsx:15).
- **Out-of-order responses:** search cancellation is untested; PaperPage has no cancellation.
- **422 from save/ask shown in the UI:** shows a generic status line (client.ts:14).

## xfail verdicts
All three agent-reported bugs are genuine app bugs, and the test expectations are correct:
1. **Corrupt PDF upload:** returns 500, should be 400.
2. **Corrupt downloaded PDF:** stays attached (`has_pdf=True` plus an orphan file).
3. **Creation-date year fallback:** dead for real `D:YYYY…` dates.

## Rough counts (of ~275)
- **Weak:** about 15–20
- **Incorrect or enshrining questionable behavior:** about 6–7
- **Redundant:** about 8–10
- **At risk of flakiness:** about 10
- **Tautological / implementation-coupled:** about 6
