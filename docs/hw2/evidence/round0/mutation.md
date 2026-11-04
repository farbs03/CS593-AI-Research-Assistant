| ID | Suite | Set | Fault | Result | Detected by |
|---|---|---|---|---|---|
| B01 | backend | visible | Context truncation removed (paper text over MAX_CONTEXT_CHARS is sent whole) | killed | tests/test_llm.py::test_paper_context_truncates_long_text |
| B02 | backend | held-out | extract_metadata always drops the year | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| B03 | backend | visible | extract_metadata copies the title into the abstract field | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| B04 | backend | held-out | answer() only forwards the last 2 history messages | killed | tests/test_api_ai.py::test_follow_up_questions_include_prior_turns |
| B05 | backend | visible | OpenAI APIError no longer wrapped as LLMError | killed | tests/test_llm.py::test_chat_wraps_api_error_as_llm_error |
| B06 | backend | held-out | Hyphenated line breaks not re-joined | killed | tests/test_pdf.py::test_extract_text_rejoins_hyphenated_line_breaks |
| B07 | backend | visible | Heuristic year picks the latest year instead of the earliest | killed | tests/test_pdf.py::test_heuristic_metadata_year_is_earliest_plausible_near_top |
| B08 | backend | held-out | arXiv-id year computed in the wrong century | killed | tests/test_api_papers.py::test_upload_merges_llm_and_heuristic_metadata |
| B09 | backend | visible | extract_text ignores max_pages | killed | tests/test_api_papers.py::test_upload_llm_only_sees_first_two_pages |
| B10 | backend | held-out | Semantic Scholar results never use the arXiv id (breaks cross-provider dedup) | killed | tests/test_search.py::test_s2_prefers_arxiv_id_and_derives_pdf_url |
| B11 | backend | visible | arXiv ids keep their version suffix (v1, v2...) | killed | tests/test_search.py::test_parse_arxiv_maps_entries |
| B12 | backend | held-out | arXiv search no longer loosens AND to OR when nothing matches | killed | tests/test_search.py::test_arxiv_search_falls_back_to_or_when_and_finds_nothing |
| B13 | backend | visible | Semantic Scholar 429 retry checks the wrong status code | killed | tests/test_search.py::test_s2_retries_once_after_429 |
| B14 | backend | held-out | Semantic Scholar authors missing names are no longer filtered | killed | tests/test_search.py::test_s2_handles_missing_optional_fields |
| B15 | backend | visible | Stopwords no longer removed from arXiv queries | killed | tests/test_search.py::test_arxiv_query_builder[the |
| B16 | backend | held-out | Save dedup compares the wrong column | killed | tests/test_api_papers.py::test_save_is_idempotent_by_external_id |
| B17 | backend | visible | Upload size limit doubled | killed | tests/test_api_papers.py::test_upload_rejects_oversized_pdf |
| B18 | backend | held-out | Heuristic metadata overrides LLM metadata on upload | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| B19 | backend | visible | Deleting a paper leaves its PDF file on disk | killed | tests/test_api_papers.py::test_delete_removes_paper_chat_and_file |
| B20 | backend | held-out | Deleting a paper leaves its chat messages behind | killed | tests/test_api_papers.py::test_delete_removes_paper_chat_and_file |
| B21 | backend | visible | Failed PDF download on save is no longer tolerated | killed | tests/test_api_papers.py::test_save_falls_back_to_abstract_when_pdf_unavailable[http-404] |
| B22 | backend | held-out | Summary ignores regenerate=true (always serves cache) | killed | tests/test_api_ai.py::test_summary_regenerate_overwrites_cache |
| B23 | backend | visible | Abstract preferred over full text for the LLM | killed | tests/test_api_ai.py::test_summary_generated_from_full_text_and_persisted |
| B24 | backend | held-out | Chat history returned newest-first | killed | tests/test_api_ai.py::test_ask_returns_and_persists_message_pair |
| B25 | backend | visible | LLM failure on chat returns 500 instead of 502 | killed | tests/test_api_ai.py::test_ask_llm_failure_is_502_and_nothing_saved |
| B26 | backend | held-out | Search results never marked as already saved | killed | tests/test_api_search.py::test_search_marks_results_already_in_library |
| F01 | frontend | visible | Server error detail message ignored | killed | uses the FastAPI "detail" string as the error message<br>src/api/client.test.ts > request error handling > uses the FastAPI "detail" string as the error message |
| F02 | frontend | held-out | 204 No Content responses parsed as JSON | killed | returns undefined for 204 No Content<br>src/api/client.test.ts > request error handling > returns undefined for 204 No Content |
| F03 | frontend | visible | JSON requests sent with the wrong HTTP method | killed | savePaper POSTs the paper as JSON<br>src/api/client.test.ts > endpoints > savePaper POSTs the paper as JSON |
| F04 | frontend | held-out | 'N more' authors count is wrong | killed | shows at most six authors and counts the rest<br>src/components/PaperCard.test.tsx > PaperCard > shows at most six authors and counts the rest |
| F05 | frontend | visible | Long abstracts no longer truncated | killed | truncates long abstracts at 420 chars and toggles the full text<br>src/components/PaperCard.test.tsx > PaperCard > truncates long abstracts at 420 chars and toggles the full text |
| F06 | frontend | held-out | Removed paper stays in the library list | killed | remove deletes the paper and drops it from the list<br>src/library.test.tsx > LibraryProvider > remove deletes the paper and drops it from the list |
| F07 | frontend | visible | savedIdFor matches the wrong paper | killed | savedIdFor maps external ids to saved paper ids<br>src/library.test.tsx > LibraryProvider > savedIdFor maps external ids to saved paper ids |
| F08 | frontend | held-out | Library filter only searches titles | killed | filters by author (case-insensitive)<br>src/pages/LibraryPage.test.tsx > LibraryPage > filters by author (case-insensitive) |
| F09 | frontend | visible | Client-side PDF check is case-sensitive on the extension | killed | accepts a .pdf file even without a PDF mime type<br>src/pages/LibraryPage.test.tsx > LibraryPage > accepts a .pdf file even without a PDF mime type |
| F10 | frontend | held-out | Shift+Enter submits the question instead of adding a newline | killed | Enter submits but Shift+Enter inserts a newline<br>src/pages/PaperPage.test.tsx > PaperPage chat > Enter submits but Shift+Enter inserts a newline |
| F11 | frontend | visible | Search query not trimmed before submitting | killed | searches on submit, puts the query in the URL and lists results<br>src/pages/SearchPage.test.tsx > SearchPage > searches on submit, puts the query in the URL and lists results |

- **visible**: 19/19 killed (100.0%)
- **held-out**: 18/18 killed (100.0%)
- **all**: 37/37 killed (100.0%)
- **backend**: 26/26 killed (100.0%)
- **frontend**: 11/11 killed (100.0%)
