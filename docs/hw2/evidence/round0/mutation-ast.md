| ID | Set | Location | Operator | Original → Mutant | Result | Detected by |
|---|---|---|---|---|---|---|
| A001 | visible | app/config.py:7 | stmt_to_pass | `load_dotenv(BACKEND_DIR / '.env')` → `pass` | survived |  |
| A002 | held-out | app/config.py:9 | binop | `BACKEND_DIR / 'data'` → `BACKEND_DIR * 'data'` | killed |  |
| A003 | visible | app/config.py:9 | constant | `'data'` → `""` | survived |  |
| A004 | held-out | app/config.py:10 | constant | `'uploads'` → `""` | survived |  |
| A005 | visible | app/config.py:11 | constant | `'papers.db'` → `""` | survived |  |
| A006 | held-out | app/config.py:14 | constant | `'LLM_API_KEY'` → `""` | killed | tests/test_api_search.py::test_health |
| A007 | visible | app/config.py:15 | constant | `'muse-spark-1.3'` → `""` | survived |  |
| A008 | held-out | app/config.py:21 | constant | `True` → `False` | survived |  |
| A009 | visible | app/db.py:13 | stmt_to_pass | `SQLModel.metadata.create_all(engine)` → `pass` | survived |  |
| A010 | held-out | app/db.py:7 | constant | `'check_same_thread'` → `""` | survived |  |
| A011 | visible | app/db.py:7 | constant | `False` → `True` | survived |  |
| A012 | held-out | app/llm.py:24 | return_none | `return _client` → `return None` | killed | tests/test_llm.py::test_get_client_uses_configured_endpoint_and_is_cached |
| A013 | visible | app/llm.py:60 | return_none | `return {'title': (data.get('title') or '').strip() or None, 'authors': [str(a).strip() for` → `return None` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A014 | held-out | app/llm.py:22 | compare | `_client is None` → `_client is not None` | killed | tests/test_llm.py::test_get_client_uses_configured_endpoint_and_is_cached |
| A015 | visible | app/llm.py:53 | drop_not | `not m` → `m` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A016 | held-out | app/llm.py:61 | constant | `'title'` → `""` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A017 | visible | app/llm.py:62 | constant | `'authors'` → `""` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A018 | held-out | app/llm.py:54 | constant | `'LLM did not return JSON metadata'` → `""` | killed | tests/test_llm.py::test_extract_metadata_no_json_raises |
| A019 | visible | app/llm.py:49 | constant | `12000` → `12001` | survived |  |
| A020 | held-out | app/llm.py:82 | constant | `'role'` → `""` | killed | tests/test_llm.py::test_summarize_sends_system_prompt_and_paper_context |
| A021 | visible | app/llm.py:64 | constant | `'abstract'` → `""` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A022 | held-out | app/main.py:27 | stmt_to_pass | `app.include_router(search.router)` → `pass` | killed | tests/test_api_search.py::test_search_returns_provider_and_results |
| A023 | visible | app/main.py:34 | return_none | `return {'status': 'ok', 'llm_model': LLM_MODEL, 'llm_configured': bool(LLM_API_KEY)}` → `return None` | killed | tests/test_api_search.py::test_health |
| A024 | held-out | app/main.py:34 | constant | `'llm_configured'` → `""` | killed | tests/test_api_search.py::test_health |
| A025 | visible | app/main.py:23 | constant | `'http://localhost:5173'` → `""` | killed | tests/test_api_search.py::test_cors_allows_vite_dev_origin |
| A026 | held-out | app/models.py:49 | constant | `True` → `False` | killed |  |
| A027 | visible | app/models.py:62 | constant | `'pdf_path'` → `""` | survived |  |
| A028 | held-out | app/pdf.py:21 | return_none | `return r.content` → `return None` | killed | tests/test_api_papers.py::test_save_downloads_pdf_and_extracts_full_text |
| A029 | visible | app/pdf.py:35 | constant | `'arXiv:([0-2]\\d)(?:0[1-9]\|1[0-2])\\.\\d{4,5}'` → `""` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A030 | held-out | app/pdf.py:83 | constant | `'-\\n(?=[a-z])'` → `""` | killed | tests/test_pdf.py::test_extract_text_rejoins_hyphenated_line_breaks |
| A031 | visible | app/pdf.py:55 | constant | `2000` → `2001` | killed | tests/test_api_papers.py::test_upload_merges_llm_and_heuristic_metadata |
| A032 | held-out | app/pdf.py:73 | negate_cond | `if span['text'].strip() and (not span['text'].lstrip().startswith('arXiv:')):` → `if not (span['text'].strip() and (not span['text'].lstrip().startswith('arXiv:'))):` | killed | tests/test_api_papers.py::test_upload_falls_back_to_heuristics_when_llm_fails |
| A033 | visible | app/pdf.py:51 | constant | `'[;,]\| and '` → `""` | killed | tests/test_api_papers.py::test_upload_merges_llm_and_heuristic_metadata |
| A034 | held-out | app/pdf.py:61 | constant | `3000` → `3001` | killed | tests/test_pdf.py::test_heuristic_metadata_abstract_capped_at_3000_chars |
| A035 | visible | app/pdf.py:84 | constant | `'\n\n'` → `""` | killed | tests/test_pdf.py::test_clean_collapses_three_or_more_newlines_and_strips |
| A036 | held-out | app/pdf.py:58 | constant | `'creationDate'` → `""` | killed | tests/test_pdf.py::test_heuristic_metadata_year_falls_back_to_creation_date |
| A037 | visible | app/pdf.py:70 | constant | `0` → `1` | killed | tests/test_api_papers.py::test_upload_falls_back_to_heuristics_when_llm_fails |
| A038 | held-out | app/pdf.py:46 | constant | `'title'` → `""` | killed | tests/test_pdf.py::test_heuristic_metadata_prefers_embedded_metadata |
| A039 | visible | app/pdf.py:59 | constant | `1` → `2` | killed | tests/test_pdf.py::test_heuristic_metadata_year_falls_back_to_creation_date |
| A040 | held-out | app/pdf.py:70 | constant | `'dir'` → `""` | killed | tests/test_pdf.py::test_heuristic_metadata_ignores_rotated_text_for_title |
| A041 | visible | app/pdf.py:70 | constant | `1` → `2` | survived |  |
| A042 | held-out | app/pdf.py:73 | constant | `'arXiv:'` → `""` | killed | tests/test_api_papers.py::test_upload_falls_back_to_heuristics_when_llm_fails |
| A043 | visible | app/pdf.py:73 | constant | `'text'` → `""` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A044 | held-out | app/pdf.py:74 | constant | `'size'` → `""` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A045 | visible | app/pdf.py:74 | constant | `'text'` → `""` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A046 | held-out | app/routes/ai.py:29 | negate_cond | `if paper.summary and (not regenerate):` → `if not (paper.summary and (not regenerate)):` | killed | tests/test_api_ai.py::test_summary_generated_from_full_text_and_persisted |
| A047 | visible | app/routes/ai.py:43 | return_none | `return session.exec(select(ChatMessage).where(ChatMessage.paper_id == paper_id).order_by(C` → `return None` | killed | tests/test_api_ai.py::test_chat_history_initially_empty |
| A048 | held-out | app/routes/ai.py:53 | negate_cond | `if not question:` → `if not not question:` | killed | tests/test_api_ai.py::test_ask_returns_and_persists_message_pair |
| A049 | visible | app/routes/ai.py:66 | stmt_to_pass | `session.commit()` → `pass` | killed | tests/test_api_ai.py::test_ask_returns_and_persists_message_pair |
| A050 | held-out | app/routes/ai.py:29 | boolop | `paper.summary and (not regenerate)` → `paper.summary or not regenerate` | killed | tests/test_api_ai.py::test_summary_generated_from_full_text_and_persisted |
| A051 | visible | app/routes/ai.py:30 | return_none | `return SummaryResponse(summary=paper.summary)` → `return None` | killed | tests/test_api_ai.py::test_summary_is_cached |
| A052 | held-out | app/routes/ai.py:26 | constant | `'/{paper_id}/summary'` → `""` | killed | tests/test_api_ai.py::test_summary_generated_from_full_text_and_persisted |
| A053 | visible | app/routes/ai.py:48 | constant | `'/{paper_id}/chat'` → `""` | killed | tests/test_api_ai.py::test_ask_returns_and_persists_message_pair |
| A054 | held-out | app/routes/ai.py:10 | constant | `'/api/papers'` → `""` | killed | tests/test_api_ai.py::test_summary_generated_from_full_text_and_persisted |
| A055 | visible | app/routes/ai.py:29 | drop_not | `not regenerate` → `regenerate` | killed | tests/test_api_ai.py::test_summary_is_cached |
| A056 | held-out | app/routes/ai.py:72 | constant | `204` → `205` | killed | tests/test_api_ai.py::test_clear_chat_only_affects_that_paper |
| A057 | visible | app/routes/ai.py:10 | constant | `'ai'` → `""` | survived |  |
| A058 | held-out | app/routes/ai.py:54 | constant | `400` → `401` | killed | tests/test_api_ai.py::test_ask_empty_question_is_400 |
| A059 | visible | app/routes/papers.py:61 | stmt_to_pass | `session.commit()` → `pass` | killed | tests/test_api_papers.py::test_save_without_pdf_url_is_abstract_only |
| A060 | held-out | app/routes/papers.py:63 | return_none | `return to_read(paper)` → `return None` | killed | tests/test_api_papers.py::test_save_without_pdf_url_is_abstract_only |
| A061 | visible | app/routes/papers.py:71 | negate_cond | `if len(data) > MAX_UPLOAD_BYTES:` → `if not len(data) > MAX_UPLOAD_BYTES:` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A062 | held-out | app/routes/papers.py:94 | stmt_to_pass | `session.add(paper)` → `pass` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A063 | visible | app/routes/papers.py:97 | return_none | `return to_read(paper)` → `return None` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A064 | held-out | app/routes/papers.py:103 | negate_cond | `if not paper.pdf_path:` → `if not not paper.pdf_path:` | killed | tests/test_api_papers.py::test_get_pdf_serves_uploaded_file |
| A065 | visible | app/routes/papers.py:111 | stmt_to_pass | `session.exec(delete(ChatMessage).where(ChatMessage.paper_id == paper_id))` → `pass` | killed | tests/test_api_papers.py::test_delete_removes_paper_chat_and_file |
| A066 | held-out | app/routes/papers.py:22 | drop_not | `not paper` → `paper` | killed | tests/test_api_ai.py::test_summary_generated_from_full_text_and_persisted |
| A067 | visible | app/routes/papers.py:66 | constant | `'/upload'` → `""` | killed | tests/test_api_papers.py::test_upload_uses_llm_metadata |
| A068 | held-out | app/routes/papers.py:32 | constant | `'full'` → `""` | killed | tests/test_api_papers.py::test_save_downloads_pdf_and_extracts_full_text |
| A069 | visible | app/routes/papers.py:105 | binop | `UPLOAD_DIR / paper.pdf_path` → `UPLOAD_DIR * paper.pdf_path` | killed | tests/test_api_papers.py::test_get_pdf_serves_uploaded_file |
| A070 | held-out | app/routes/papers.py:104 | constant | `404` → `405` | killed | tests/test_api_papers.py::test_get_pdf_without_stored_pdf_404 |
| A071 | visible | app/routes/papers.py:105 | constant | `'application/pdf'` → `""` | killed | tests/test_api_papers.py::test_get_pdf_serves_uploaded_file |
| A072 | held-out | app/routes/papers.py:50 | compare | `Paper.external_id == body.external_id` → `Paper.external_id != body.external_id` | killed | tests/test_api_papers.py::test_save_is_idempotent_by_external_id |
| A073 | visible | app/search.py:17 | constant | `'https://export.arxiv.org/api/query'` → `""` | killed | tests/test_search.py::test_arxiv_search_uses_and_query_first |
| A074 | held-out | app/search.py:125 | return_none | `return re.sub('\\s+', ' ', s).strip()` → `return None` | killed | tests/test_search.py::test_parse_arxiv_maps_entries |
| A075 | visible | app/search.py:18 | constant | `'a'` → `""` | killed | tests/test_search.py::test_parse_arxiv_maps_entries |
| A076 | held-out | app/search.py:93 | stmt_to_pass | `results.append(SearchResult(source='arxiv', external_id=f'arxiv:{arxiv_id}', title=_squash` → `pass` | killed | tests/test_search.py::test_parse_arxiv_maps_entries |
| A077 | visible | app/search.py:108 | constant | `'a'` → `""` | killed | tests/test_search.py::test_arxiv_query_builder[the |
| A078 | held-out | app/search.py:108 | constant | `'the'` → `""` | killed | tests/test_search.py::test_arxiv_query_builder[the |
| A079 | visible | app/search.py:108 | constant | `'are'` → `""` | survived |  |
| A080 | held-out | app/search.py:108 | constant | `'for'` → `""` | killed | tests/test_search.py::test_arxiv_query_builder[diffusion |
| A081 | visible | app/search.py:108 | constant | `'or'` → `""` | survived |  |
| A082 | held-out | app/search.py:109 | constant | `'as'` → `""` | survived |  |
| A083 | visible | app/search.py:121 | negate_cond | `(found.text or '').strip() if found is not None else ''` → `(found.text or '').strip() if not found is not None else ''` | killed | tests/test_search.py::test_parse_arxiv_maps_entries |
| A084 | held-out | app/search.py:39 | constant | `'limit'` → `""` | killed | tests/test_search.py::test_s2_maps_fields_and_sends_query_params |
| A085 | visible | app/search.py:42 | compare | `r.status_code == 429` → `r.status_code != 429` | killed | tests/test_search.py::test_s2_retries_once_after_429 |
| A086 | held-out | app/search.py:79 | stmt_to_pass | `r.raise_for_status()` → `pass` | killed | tests/test_search.py::test_arxiv_search_http_error_raises |
| A087 | visible | app/search.py:49 | constant | `'ArXiv'` → `""` | killed | tests/test_search.py::test_s2_prefers_arxiv_id_and_derives_pdf_url |
| A088 | held-out | app/search.py:72 | constant | `'AND'` → `""` | killed | tests/test_search.py::test_arxiv_search_uses_and_query_first |
| A089 | visible | app/search.py:90 | constant | `'a:id'` → `""` | killed | tests/test_search.py::test_parse_arxiv_maps_entries |
| A090 | held-out | app/search.py:40 | constant | `15` → `16` | survived |  |
| A091 | visible | app/search.py:50 | constant | `'url'` → `""` | killed | tests/test_search.py::test_s2_maps_fields_and_sends_query_params |
| A092 | held-out | app/search.py:71 | constant | `True` → `False` | survived |  |
| A093 | visible | app/search.py:76 | constant | `'relevance'` → `""` | killed | tests/test_search.py::test_arxiv_search_uses_and_query_first |
| A094 | held-out | app/search.py:58 | boolop | `item.get('title') or '(untitled)'` → `item.get('title') and '(untitled)'` | killed | tests/test_search.py::test_s2_maps_fields_and_sends_query_params |
| A095 | visible | app/search.py:91 | constant | `'/abs/'` → `""` | killed | tests/test_search.py::test_parse_arxiv_maps_entries |
| A096 | held-out | app/search.py:99 | negate_cond | `int(published[:4]) if published[:4].isdigit() else None` → `int(published[:4]) if not published[:4].isdigit() else None` | killed | tests/test_search.py::test_parse_arxiv_maps_entries |
| A097 | visible | app/search.py:50 | constant | `'openAccessPdf'` → `""` | killed | tests/test_search.py::test_s2_maps_fields_and_sends_query_params |
| A098 | held-out | app/search.py:100 | constant | `'a:summary'` → `""` | killed | tests/test_search.py::test_parse_arxiv_maps_entries |
| A099 | visible | app/search.py:98 | constant | `'a:author'` → `""` | killed | tests/test_search.py::test_parse_arxiv_maps_entries |
| A100 | held-out | app/search.py:57 | constant | `'paperId'` → `""` | killed | tests/test_search.py::test_s2_maps_fields_and_sends_query_params |

- **visible**: 38/50 killed (76.0%)
- **held-out**: 44/50 killed (88.0%)
- **all**: 82/100 killed (82.0%)
