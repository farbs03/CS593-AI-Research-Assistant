# Intended-behavior spec given to the agent in Round 2

Written by the developer from the README (feature table and API table) plus general API-contract
expectations. It states *requirements*, not known bugs. The agent must find out for itself
whether the app meets each one.

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
