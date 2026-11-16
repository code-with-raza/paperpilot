# PaperPilot frontend

React, TypeScript, Tailwind CSS and Vite. The existing ivory, white and teal interface, paper library, chat layout and PDF preview are preserved. This integration changes frontend files only.

## Run locally

From `frontend/`:

```powershell
npm install
npm run dev
```

Run the existing FastAPI server separately on port 8000. Open Vite's printed URL, normally `http://127.0.0.1:5173`. Vite forwards `/api` to `http://127.0.0.1:8000`. To use a different API port, set `API_PROXY_TARGET` in the frontend `.env` and restart Vite.

## Authentication

The app checks `GET /auth/me` before loading private data. Signed-out users see the existing login/register pages (`/#/login`, `/#/register`). Both forms validate locally and submit email/password to `POST /auth/login` or `POST /auth/register`. A second `/auth/me` confirms that the browser received a usable HTTP-only session cookie before opening the workspace. The existing backend reports a successfully created account awaiting email verification as `403` with `Please verify your email before logging in.`. That exact registration response opens a styled confirmation screen with inbox/Gmail and Spam/Junk guidance. It clears password fields and never calls the authenticated callback or opens the workspace. Other registration errors remain errors; login/session verification behavior is preserved.

All API requests use `credentials: 'include'`. Tokens and passwords are never written to localStorage or sessionStorage. The account ID comes from the server-confirmed user, not the old editable workspace selector. Settings shows the signed-in email. `POST /auth/logout` clears the workspace after confirmation; a network failure keeps a visible error. A private API's 401 response unmounts private state and returns to login with a session-expired message.

For local HTTP development, the existing backend's secure-cookie configuration must allow the browser to send its cookie. The backend exposes `PAPERPILOT_COOKIE_SECURE` and defaults it to `true`; if a local HTTP browser rejects the secure cookie, the backend launch environment needs the appropriate development setting. Production should use HTTPS and secure cookies. No backend code or environment files were changed here.

## Conversations

- `GET /conversations/` supplies the sidebar in the backend's updated-at order.
- `POST /conversations/` creates a paper-based chat. New Chat requires a selected paper and reuses an already selected empty conversation to avoid accidental duplicates. Sending the first question also creates a conversation if needed.
- `GET /conversations/{id}` loads saved messages in their original order and restores the associated paper and PDF.
- `POST /conversations/{id}/messages` sends only `{ question }`. Returned saved user and assistant messages are appended once by ID. The old paper ask endpoint is not used.
- `DELETE /conversations/{id}` requires confirmation. Deleting the selected conversation clears its messages while preserving the paper library.
- The selected conversation ID is remembered per server-confirmed account. Message content always reloads from the API, including after a page refresh. Follow-up context is handled by the backend.
- Generation failure triggers a details refresh because the backend may already have saved the question. If recovery fails, ordinary questions remain blocked until a successful reload, but the composer can still import a new paper URL. Failed requests never automatically resend a question; inspect the recovered history before retrying.
- Account changes unmount previous messages, notes state and PDF object URLs, and abort outstanding requests. Sidebar entries are additionally checked against the current server-confirmed account ID.

The backend currently creates conversations titled `New chat` and has no rename endpoint. The frontend displays the titles returned by the server.

## Papers and evidence

Paper endpoints are unchanged on the server: `GET /papers/`, `POST /uploadfile/` with a `file` form field, `POST /import-url/` with `{ pdf_url }`, and `GET /papers/{id}/pdf`. The frontend sends no controlled `user_id` in query strings, JSON or form data. Ownership comes from the session cookie.

Upload a PDF or paste a complete modern arXiv abstract/PDF URL or direct PDF URL into the chat composer. URL query parameters are preserved. Enter submits the same form as Send; Shift+Enter inserts a newline. IME composition and repeated held-Enter keydown events do not submit prematurely. Successful imports/uploads become the active paper and open their preview. Switching papers clears the selected conversation so a new question cannot accidentally go to the previous paper's chat. The current backend queues ingestion and returns `processing`; an absent status is conservatively treated as `processing`. Pending processing statuses still refresh from the paper library every five seconds when no operation is busy. A paper can be previewed during processing, but questions wait for `ready`.

Saved answer text, Markdown, citations, section names, page ranges and confidence text are displayed using the existing renderer. Plain-text evidence metadata is parsed as before; structured `sources` are supported when present. Raw HTML and answer images are not executed/loaded. Missing page numbers are not invented. The backend currently saves generated answers as content with null structured sources, so evidence is recovered from its existing source/confidence lines.

Server PDFs load with the authenticated request helper. Uploaded or manually attached preview copies remain an optional IndexedDB fallback, scoped by account and paper. Notes remain browser-local, scoped by account, and can be exported as Markdown. Summary requests now go through the selected persistent conversation. Comparison remains marked as planned.

## Build and checks

```powershell
npm run typecheck
npm run build
npm test
```

Browser checks use Playwright and controlled API fixtures; they never modify backend data or call the model. If Playwright Chromium is not installed, use `npx playwright install chromium` or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed Chrome path. Tests cover session checks, real request contracts, login/register failures, cookie verification, history loading/restoration, sends, generation recovery, deletion confirmation, account changes, expiry, imports, upload, evidence, notes, and mobile layout. Screenshots go to the ignored project `tmp/` folder. These tests verify frontend behavior, not live deployment cookie settings or server-side authorization.

`dist/` is the production build. The Vite proxy is development-only: production hosting must reverse-proxy `/api` to FastAPI, or configure `VITE_API_BASE_URL` with a server that permits credentialed requests from the frontend origin. Prefer the same site for the cookie and API. For subdirectory hosting set `VITE_BASE_PATH` before building. All `VITE_` values are public; never place secrets in them. No dependencies were added.


For a self-contained explanation of the current registration, submission, import, processing, API and security flow, see [FRONTEND-FLOW-SUMMARY.md](FRONTEND-FLOW-SUMMARY.md).
