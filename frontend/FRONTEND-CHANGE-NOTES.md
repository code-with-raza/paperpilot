# PaperPilot frontend change notes

Date: 4 November 2026  
Scope: the latest frontend completion and reliability review

## 1. What this work covered

The main goal was to let a user paste an arXiv or direct PDF URL into the existing chat composer, import the paper through the existing backend, and immediately see that paper selected in Chat and My Papers with its PDF preview.

The review also covered uploads, library selection, chat retries, Markdown answers, citations, workspace changes, responsive layout, and frontend configuration.

The existing React, TypeScript, Tailwind, and Vite application was retained. The ivory-and-teal visual identity, sidebar, navigation, and existing working features were preserved. Existing files and API helpers were reused rather than replacing the application with a new implementation.

No backend source files or API contracts were modified. Python source hashes recorded before the work matched after completion. The existing `/import-url/` and PDF-serving endpoints were supplied by the backend and connected by the frontend; they were not created as part of this frontend work.

## 2. Files changed

Paths below are relative to `frontend/`.

| File | Changes |
| --- | --- |
| `src/App.tsx` | Completed composer URL handling, readable import/upload/question handlers, paper selection and synchronization, processing-state display, retries, workspace/request guards, Markdown presentation, and citation navigation. Formatted the JSX and handlers for readability. |
| `src/api.ts` | Added supported-URL detection and normalization, reused the URL-import helper, added optional cancellation signals, improved response/error handling, validated library response structure, and checked PDF response signatures. |
| `src/answer.ts` | Improved parsing of source metadata and confidence text; preserved source IDs where they can be mapped; added inline citation links; protected fenced code from metadata extraction. |
| `src/SourcePreview.tsx` | Added a Retry preview action and retained clear loading, unavailable-file, error, and local-attachment states. |
| `src/usePaperPreview.ts` | Added preview retry handling and unmount guards while preserving server loading, local fallback, workspace-specific keys, and protection against stale results. |
| `src/styles.css` | Added selected-paper styling, Markdown typography, tables/code-block overflow handling, citation buttons, question retry styling, and responsive supporting text. Reformatted the stylesheet. |
| `tests/workspace.spec.ts` | Extended the existing browser test file to cover the completed workflows. Updated refresh expectations to keep the selected paper. No separate test files were created. |
| `package.json` | Added `react-markdown`, `remark-gfm`, and a `typecheck` script. Retained the existing development, build, preview, and test scripts. |
| `package-lock.json` | Recorded the installed Markdown packages and their dependency versions. |
| `vite.config.ts` | Added support for a configurable frontend deployment base path through `VITE_BASE_PATH`. Preserved the development API proxy. |
| `.env.example` | Documented `VITE_BASE_PATH` alongside the existing API settings. |
| `index.html` | Made the favicon path follow Vite's configured base path. |
| `README.md` | Documented the connected workflows, verification commands, deployment configuration, storage behavior, and backend limitations. |

This change-note file was added afterward to document the completed work. Creating this note did not change application behavior.

## 3. Chat composer and paper URL importing

### Previous problem

The application already had a URL-import helper and some detection logic, but the composer and send button were disabled when there was no active paper. A user with an empty library therefore could not submit a paper URL through chat.

The import handler also treated returned papers as ready without preserving an explicit processing status.

### Current behavior

1. The composer is available even when no paper is selected.
2. Sending a complete supported URL starts an import rather than a question request.
3. The frontend calls `importPaperFromUrl()` using the existing `/import-url/` endpoint.
4. An importing message and loading indicator appear while the request is running.
5. The composer and submit button are disabled during the operation.
6. A successful response adds the paper, selects it, opens Chat, shows the source panel, and resets the PDF page to 1.
7. The library is synchronized with the server without displaying the same paper ID twice.
8. On failure, the original input is restored so the user can correct or resend it.

Normal questions continue to use the existing question endpoint. If no ready paper is selected, the frontend explains that a paper must be uploaded or imported first; it does not send an ordinary question without a valid paper context.

### Supported examples

```text
https://arxiv.org/abs/1706.03762
https://arxiv.org/pdf/1706.03762.pdf
https://arxiv.org/pdf/1706.03762v2
https://example.org/paper.pdf?download=1&utm_source=example
```

Modern arXiv PDF URLs are normalized to abstract URLs before calling the backend. This lets the existing backend perform the PDF conversion and avoids an accidental second `.pdf` suffix.

For direct PDF URLs, detection checks the URL pathname, so query parameters do not prevent recognition. Those query parameters are preserved when importing.

Only a complete supported URL is imported. A normal question containing a link is not automatically converted into an import. Unsupported complete web URLs receive a validation message instead of being submitted as ordinary questions.

### Keyboard behavior

- Enter submits the current input.
- Shift+Enter inserts a new line.
- Enter during IME text composition does not submit prematurely.
- An immediate request lock prevents duplicate requests before the disabled-button state has rendered.

## 4. Uploads and processing status

The upload workflow still calls the existing multipart `/uploadfile/` endpoint using `file` and `user_id`.

The frontend retains PDF extension/MIME checks and the 50 MB file-size limit. Invalid selections produce visible feedback. Uploading/processing states remain visible while waiting for the server.

Successful uploads are selected automatically and made available in My Papers. The local file can still be saved as a browser preview fallback.

Returned statuses are preserved. If the current synchronous endpoint omits a status after a successful response, the frontend uses its existing success convention of `ready`. An explicitly returned `processing` status is not changed to `ready`.

Pending papers are refreshed through the library every five seconds while no import, upload, or answer operation is busy. Questions remain unavailable for a paper until the library reports it as ready. Failed papers are shown as failed rather than appearing ready.

## 5. My Papers and active-paper selection

### Library consistency

- Papers continue to load through `listPapers(userId)`.
- Entries are deduplicated by `paper_id`.
- Filename search and manual refresh remain available.
- Each entry shows its processing status using understandable text.
- The active entry has a visible selected style and an `aria-pressed` state.
- Existing papers remain visible during a refresh instead of being replaced with an empty loading screen.
- A just-imported paper is retained if a list response has not yet caught up with the successful import.

Deduplication here means one displayed entry per paper ID. It does not detect identical PDF content uploaded under different IDs; file-hash deduplication remains a backend concern.

### Selection persistence

The selected paper ID is saved separately for each workspace:

```text
paperpilot:selected:<user_id>
```

After a refresh, the frontend restores that selection if the paper still exists. If it no longer exists, the frontend selects an available ready paper, then another available paper if necessary.

Opening a library paper displays its conversation and reopens the source panel even if the panel was previously hidden.

## 6. PDF preview behavior

The right-side preview continues to request the selected paper using:

```text
GET /papers/{paper_id}/pdf?user_id=...
```

Imported papers do not require a browser-selected `File` object. Their original PDF is fetched from the backend.

The frontend checks that the response has a PDF content type and starts with the PDF file signature. An HTML error response or another unexpected document is not silently treated as a PDF.

The preview provides:

- A loading state while fetching the paper.
- The server's failure information when the request fails.
- A Retry preview action.
- A saved local fallback when the server PDF is unavailable and a fallback exists.
- Manual attachment when automatic opening is unavailable.
- Page navigation and citation-driven page changes.

Local fallback PDFs remain scoped by workspace user ID and paper ID in IndexedDB. They are separate from the actual server-stored document.

The frontend does not fabricate highlighted evidence passages or line numbers. Citation page jumps depend on the browser's built-in PDF viewer supporting page fragments.

## 7. Chat messages and retries

Conversation state remains associated with each selected paper. Switching papers displays the matching conversation rather than mixing messages from different papers.

When an answer request fails:

- The submitted question remains in the conversation.
- The input is restored.
- A visible error explains the problem.
- The failed message offers a Retry question button.
- That retry button reuses the original user message rather than creating another copy of the same question bubble.

Normal request failures are not displayed as invented assistant answers.

Scrolling now targets the conversation pane when messages or loading states change, rather than scrolling the entire browser page through the message sentinel.

Chat history is still session-only. Refreshing the page does not preserve messages, and the existing API does not receive previous conversation turns as follow-up context.

## 8. Markdown and answer formatting

Previously, answers were presented mainly as plain text. Markdown headings, lists, and code could therefore appear as formatting characters rather than readable structure.

Answers now use:

- `react-markdown` for Markdown rendering.
- `remark-gfm` for tables and other GitHub-style Markdown features.

The styling covers paragraphs, headings, lists, inline code, fenced code blocks, blockquotes, tables, and links. Wide code blocks and tables can scroll within the answer instead of forcing the page outside the viewport.

Raw HTML is not executed. Answer images are not loaded, and external links open with the appropriate new-tab relationship attributes.

The backend's answer text is not rewritten to invent facts. Copying and saving answers retain the original backend response.

## 9. Citation parsing and navigation

The frontend recognizes the current section/page metadata and confidence lines returned by the backend.

Improvements include:

1. Retaining explicit source IDs when provided.
2. Handling sparse IDs such as `[2]` and `[5]` without automatically displaying them as `[1]` and `[2]`.
3. Turning known inline labels such as `[Source 2]` into buttons that open the corresponding PDF page.
4. Keeping unmatched labels readable when there is insufficient metadata to connect them.
5. Displaying Page unavailable when the response does not provide a usable page number.
6. Leaving page numbers unchanged when an unavailable-page citation is clicked and explaining the missing metadata.
7. Ignoring metadata-looking lines inside fenced code blocks.

For the current backend's unlabeled metadata lines, source mapping relies on its ascending source-label order and a matching label/metadata count. The frontend does not guess a connection when that mapping cannot be established. Structured citation records from the backend would remove this remaining dependency on text ordering.

Confidence values are displayed from the backend response. Their calculation and interpretation were not changed in this frontend task.

## 10. Workspace handling and asynchronous requests

The initial workspace ID remains `default`, unless the browser already contains a saved user ID. The Settings page retains its existing behavior.

When the user switches workspace IDs, the frontend clears the previous library, messages, composer input, search, copied-answer state, and page selection before loading the new workspace.

Requests use cancellation signals and request-version checks where needed. Older library responses cannot overwrite newer workspace data or remove a newly imported paper. Aborted requests are not presented as normal request failures.

The frontend also guards relevant asynchronous updates after unmount and clears its copied-answer timer during cleanup.

The workspace ID is still a library selector, not authentication. These changes do not add sign-in, account security, or server-side access-control guarantees.

## 11. Layout, accessibility, and readability

The existing visual design was retained. Changes were limited to the controls and states needed for the completed workflows.

The review covered desktop, tablet, and mobile widths. Supporting improvements include selected-library styling, readable Markdown hierarchy, wrapping preview warnings, retry controls, and composer guidance explaining URL importing and keyboard behavior.

The upload dialog restores focus to the previous control when closed. Existing keyboard focus styles, navigation, mobile sidebar behavior, and reduced-motion support remain in place.

Source code was formatted into readable handlers, named helpers, and multiline JSX. The application was not split into a new architecture. The Markdown presentation helper lives inside the existing chat module; no new source component files were required for this review.

## 12. API and deployment configuration

Existing API configuration was preserved:

| Setting | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Public frontend API base URL; defaults to `/api`. |
| `API_PROXY_TARGET` | Development-only target for Vite's API proxy. |
| `VITE_BASE_PATH` | Added frontend deployment base path; defaults to `/`. |

For a deployment under a subdirectory, `VITE_BASE_PATH` can be set to a value such as `/paperpilot/` before building. Bundled assets and the favicon follow that base path.

The development API proxy was retained. Production still needs a real reverse proxy for `/api`, or a configured API origin that permits the frontend's requests. `vite preview` does not replace that production API setup.

No localhost address was hardcoded into production API calls. No API keys or private credentials were added to frontend code. `VITE_` variables remain public build-time settings.

## 13. Verification performed

These results were obtained after the frontend implementation. They were not rerun merely to create this documentation note.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed, including the TypeScript project check and Vite production bundle. |
| Existing Playwright browser suite | All 25 checks passed. |
| Lint | No lint command is configured; no new lint tool was introduced. |
| Frontend whitespace/diff check | Passed. |
| Backend Python source hash comparison | Unchanged during the frontend implementation. |

The existing browser suite covers:

1. arXiv abstract URL importing from an empty library.
2. arXiv PDF URL importing from an empty library.
3. Versioned arXiv URL importing.
4. Direct PDF URL importing with query parameters.
5. Shift+Enter behavior and unsupported-URL handling.
6. Failed URL import recovery and retry.
7. An unavailable import endpoint.
8. Processing status changing to ready through a library refresh.
9. Retrying questions, Markdown rendering, and source-label navigation.
10. Workspace changes with stale library responses.
11. A stale library response arriving after an import.
12. Empty-library guidance and upload-dialog keyboard dismissal.
13. Unknown source pages and metadata-like text inside code blocks.
14. Markdown tables and embedded-HTML safety.
15. Tablet layout at 768 px.
16. Tablet layout at 1024 px.
17. Question request format, answers, notes, and Markdown export.
18. PDF upload format and automatic selection.
19. Local PDF restoration after refresh and reopening a hidden preview.
20. Workspace-specific local preview storage.
21. Server PDF loading without a local attachment/cache.
22. Missing server PDF feedback.
23. Browser-storage failure with a usable session preview.
24. Failed questions retaining their input.
25. Mobile layout and navigation.

Duplicate-submit protection, automatic selection, preview opening, and library deduplication are also checked within the import scenarios.

The tests use controlled API responses in the existing test file. This is test infrastructure, not mock application functionality. They do not call a model, run real ingestion, download real publisher papers, or modify backend data. Desktop and mobile screenshots were visually reviewed as part of the frontend check.

## 14. What remains outside this frontend work

The following capabilities still require backend support or further live verification:

- Real account authentication and authorization.
- Questions across multiple selected papers or the entire library.
- Comparing 2-5 papers through a comparison endpoint.
- Persisted server-side chat history and follow-up context.
- Dedicated saved/cached summaries.
- Server-side notes and export synchronization.
- Paper deletion through an API.
- Legacy arXiv identifiers such as `hep-th/9901001`, which the current backend URL normalizer does not support.
- Content/hash-based duplicate PDF detection.
- Publisher restrictions, failed remote downloads, and backend ingestion failures.
- Model answer quality and the reliability of backend confidence calculations.
- Actual production hosting, API reverse-proxy/CORS configuration, and an end-to-end live import/answer check after deployment.

No application behavior was added to pretend that these missing capabilities already work. The comparison screen remains marked as planned, summaries continue to use the question endpoint, and notes remain browser-local.

## 15. Practical manual check after starting the app

1. Start the existing backend and the frontend development server.
2. Confirm the workspace user ID in Settings.
3. With an empty library, paste `https://arxiv.org/abs/1706.03762` into the chat composer.
4. Submit with Enter and confirm the importing indicator appears.
5. After the backend finishes, confirm that the paper is active and appears once in My Papers.
6. Confirm the actual PDF renders in the right-side panel, not just that an iframe exists.
7. Ask a question, inspect the answer, and click a citation with a known page number.
8. Switch to another paper and back, then refresh to confirm selection restoration.
9. Try a direct PDF URL with query parameters.
10. Try an invalid URL and confirm the error and original input are retained.
11. Switch workspace IDs and confirm the previous workspace's papers and chat are not displayed.

The frontend implementation passed its automated checks, but complete production readiness is not claimed while backend features and live deployment workflows remain unverified.
