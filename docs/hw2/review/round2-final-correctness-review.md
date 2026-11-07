# Final suite (after Round 2): test-correctness review

**Method:** the same as Round 0. A fresh, read-only reviewer subagent was given the identical review prompt and judged the final suite against the app's intended behavior. I spot-checked findings #1 and #6 against the source, and both were confirmed:
- In the upload-error test, the second upload navigates away from the page.
- `SearchPage.tsx:93` renders "{n} results" and `App.tsx:31` renders "{n} papers", and the tests assert "1 results" and "1 papers".

## Findings
| # | Category | Test (file::name) | Problem | Suggested fix |
|---|---|---|---|---|
| 1 | Weak (vacuous) | LibraryPage.test.tsx::"clears a previous upload error on the next attempt" | The second upload succeeds, so the page navigates away and unmounts. The error disappears whether or not `setUploadError(null)` ran. | Defer the second upload and assert while still on /library. |
| 2 | Incorrect / contradictory | test_llm.py::test_extract_metadata_non_string_authors_are_stringified | Asserts that `[42,"B"]` becomes `["42","B"]`. That is the same blind `str(a)` coercion the xfail odd-shapes test calls a bug, so fixing the bug would break this test. | Expect non-string authors to be dropped. |
| 3 | Incorrect | test_llm.py::test_chat_none_content_becomes_empty_string | Treats None content returning `""` as correct, which is the root cause of the 3 xfailed blank-response bugs. | Expect `LLMError` for None or blank content. |
| 4 | Incorrect | test_search.py::test_parse_arxiv_odd_entry_does_not_discard_the_others | Asserts `title == ""` for a bare entry. The S2 path uses `"(untitled)"`, so this locks in inconsistent normalization. | Expect `"(untitled)"`, or expect the entry to be dropped. |
| 5 | Incorrect | library.test.tsx::"remove failure keeps the paper" | Uses a 404 "Paper not found" as the failure. Keeping a paper the server says is gone leaves a ghost entry. | Use a 500; add a separate test for the 404 case. |
| 6 | Incorrect (minor) | SearchPage.test.tsx (2 tests); e2e search-and-save | Asserts "1 results for…" and `getByLabel('1 papers')`, which locks in a pluralization bug. | Assert "1 result" and "1 paper". |
| 7 | Weak | test_api_papers.py::test_odd_llm_metadata_shapes_never_corrupt_metadata (passing ids) | The oracle is set membership (`title in {LLM, Heuristic}`), so it can't tell whether valid LLM fields were thrown away. | Give each case its exact expected value. |
| 8 | Questionable expectation | test_api_papers.py::test_upload_title_falls_back_to_filename | Accepts a text-less upload as `abstract_only` with `abstract=None` and `has_pdf=True`. Summarize then says "Upload its PDF first". | Assert a distinct status or message. |
| 9 | Questionable | test_pdf.py::test_heuristic_metadata_ignores_years_outside_plausible_range | Locks in the regex's 1980 floor. | Test only that citation years and future years are rejected. |
| 10 | Weak | test_api_ai.py::test_summary_empty_strings_count_as_no_text | Checks the status code only. | Also check `detail` and that the LLM was not called. |
| 11 | Implementation-coupled | test_llm.py prompt/`_paper_context`/`_client` tests | Compare exact prompt strings and private helpers. | Keep the behavior-level checks. |
| 12 | Tautological | client.test.ts::"mock sanity › unmocked requests surface as errors" | Tests the test helper. | Remove it, or move it to helper tests. |
| 13 | Redundant | test_llm.py::test_chat_wraps_api_error_as_llm_error / test_chat_wraps_api_status_error | Both go through the same `except APIError` branch. | Merge them. |
| 14 | Redundant | test_api_papers.py: three tests of the delete 404 path | Same 404 path. | Keep the parametrized one. |
| 15 | Redundant | PaperCard.test.tsx: two source-label tests | Duplicate each other. | Remove one. |
| 16 | Flaky risk | e2e/helpers.ts::resetLibrary | Finds the live DB by scanning OS temp folders and writes through a second SQLite connection. | Add a reset hook in the shim. |
| 17 | Side effect | test_app_setup.py::fresh_module("config") | Re-running config.py calls `mkdir(exist_ok=True)` on the real `backend/data/uploads`. It's harmless (the folder exists and no data changes) but contradicts "never touch real data". | Patch `Path.mkdir`, or set a temporary data folder. |

## Missing tests (and whether the app handles each case)
- **LLM chatter containing braces after the JSON:** the greedy regex (llm.py:55) produces invalid JSON, so good metadata is lost.
- **Back to `/` after a failed search:** the error stays on screen (SearchPage.tsx:95). App bug.
- **Second search while old results are shown:** the old results appear under the new query's heading while loading (SearchPage.tsx:97-101). App bug.
- **Asking before the chat history loads:** the late `getChat` response drops the new Q&A pair (PaperPage.tsx:144-146). App bug.
- **Dropping a second PDF during an upload:** nothing guards against it, so two uploads run at once (LibraryPage.tsx:16, 36-40). App bug.
- **Clear-chat failure at unit level:** only e2e covers it.
- **Regenerate failure on the frontend:** the app is correct, but no unit test covers it.
- **arXiv error feed:** it gets parsed as a search result (search.py:84-102). App bug.
- **PDF download size during save:** there is no cap (pdf.py:13-21).
- **Whitespace-only title on POST /api/papers:** accepted (models.py:15).
- **Summarizing an uploaded scanned PDF:** returns a misleading 400 (ai.py:23).

## Verdicts on known-app-bug tests (32 items: 24 pytest xfail, 6 Vitest it.fails, 2 Playwright test.fail)

**Genuine (26):**
- blank summary [null, ws]
- reply without choices
- blank answer
- 404s[clear-chat]
- 64-bit id (genuine but over-specified: 422 would be just as valid)
- corrupt downloaded PDF
- empty external_id twice (contrived)
- out-of-range year
- odd LLM shapes ×4
- corrupt PDF upload (important)
- password-protected PDF upload
- missing PDF file → 500
- whitespace search ×2
- creation-date year
- 422 detail list
- non-numeric id
- slow previous-paper response
- late summary brings the old paper back
- history-load wording (cosmetic)
- e2e failed clear
- e2e search box after Back

**Questionable (6):**
- **arXiv `C++` / `C#` query (×2):** arXiv's tokenizer drops punctuation and `+` is a Lucene operator, so the expectation is likely wrong.
- **One odd S2 item (×3: missing paperId, null item, null author):** robustness against a payload the S2 contract rules out.
- **Search result without an external_id:** can't happen today, since the backend always sets `external_id`.

## Rough counts (of ~285 test functions, ~330 cases)
- **Weak:** about 8
- **Incorrect or enshrining buggy behavior:** about 6, plus about 4 known-bug tests with questionable or over-specified expectations
- **Redundant:** about 8
- **At risk of flakiness or side effects:** about 3
- **Tautological or implementation-coupled:** about 8
