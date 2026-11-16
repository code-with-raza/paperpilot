# PaperPilot frontend flow and implementation summary

Updated: 5 November 2026 (Asia/Karachi).

This document explains the frontend flow for another developer or GPT session. This change is frontend-only. Backend authentication, Supabase operations, email delivery/verification, ingestion workers, API security, and tenant isolation were read where necessary and were not modified.

## Files changed in this update

| File | Responsibility/change |
|---|---|
| `src/auth.ts` | Recognizes the existing registration verification-pending response; returns a typed pending/authenticated result and owns the exact confirmation wording. Continues using the shared API client. |
| `src/AuthPage.tsx` | Displays confirmation using the existing card and notification styling, clears password state, and keeps the workspace closed while verification is pending. |
| `src/App.tsx` | Routes Enter and Send through one form submission; imports complete paper URLs before checking chat-recovery state; retains processing status, refresh, preview, request-lock and error behavior. |
| `tests/workspace.spec.ts` | Extends the existing browser suite for confirmation, keyboard submission, URL import, processing and recovery cases. No additional test file. |
| `README.md` | Updates behavioral documentation and links to this summary. |
| `FRONTEND-FLOW-SUMMARY.md` | This handoff document. |

The API client, root session gate, conversation service, authentication cookie handling, CSS palette, routing, and dependencies are reused. No new fetch client, token store, backend endpoint, or layout was introduced.

## 1. Startup and authentication gate

`src/main.tsx` starts with `user = null` and checks `GET /auth/me` through `getCurrentUser()` before rendering the private workspace. A confirmed user renders `App`; an unauthenticated startup renders `AuthPage`. Authentication data is not restored from browser storage. The root mounts the workspace by server-confirmed user ID, keeping account-specific state separate.

`src/api.ts` owns base URL configuration, JSON/error handling, cancellation and all requests with `credentials: 'include'`. The backend's HTTP-only cookies carry authentication; JavaScript does not read, store or create access/refresh tokens. Existing private-API 401 handling still returns the user to login. No backend authentication or refresh policy was changed.

## 2. Registration and email verification

1. `AuthPage` validates email, required fields, password length and confirmation.
2. It calls `submitAuth('register', fields)` in `auth.ts`.
3. That function uses the existing `request()` helper to send only email and password to `POST /auth/register`.
4. The current backend uses `403` plus the exact detail `Please verify your email before logging in.` when Supabase signup returned a user without a session.
5. For that specific registration response, the frontend returns `{ status: 'verification_pending' }`. It does not call `/auth/me`, set the root user, or invoke `onAuthenticated`.
6. The registration card becomes a confirmation screen headed **Check your email.** It uses the existing `.auth-availability` notification style with `role="status"`, preserving keyboard focus and the responsive layout.
7. Password and confirm-password values are cleared. The registration form is hidden to prevent accidental repeat submissions. A Log in link remains available.

Exact displayed message:

> Your account has been created successfully! Please check your email inbox (or Gmail) for the verification link. If you don't see it, check your Spam or Junk folder. Verify your email before logging in.

Unrelated 403 responses, duplicate-account errors, validation errors and network failures remain errors. A generic forbidden response is never treated as successful signup. Backend verification and email delivery are not simulated. Users verify through the backend's email link and then sign in normally.

If the backend instead returns a successful registration with a usable session, the existing successful-session path is preserved. Login and this successful-session path still require a successful `/auth/me` before returning `{ status: 'authenticated', user }`. Only that result invokes the root authenticated callback. Pending verification never takes that path.

## 3. One chat submission path

The chat textarea is named `question` and belongs to the existing `.composer` form.

- Plain Enter prevents the textarea's newline behavior and calls its form's `requestSubmit()`.
- Shift+Enter remains native textarea behavior and inserts a newline.
- Enter during IME composition is not submitted.
- Repeated keydown events from holding Enter are ignored for submission.
- Send is the same form's submit button.
- The form reads the textarea's current value with `FormData` and calls the existing `ask(text)` handler. Keyboard and click do not have separate request logic.
- The operation ref locks synchronously before React rerenders, preventing a second active import/answer request. Disabled controls and loading feedback reflect the operation.

## 4. URL routing versus ordinary questions

`ask()` trims the submitted input and calls existing `getPaperUrl()` from `api.ts` before applying chat-history recovery checks.

Complete supported URLs are imported:

- Modern arXiv abstract URLs, e.g. `https://arxiv.org/abs/1706.03762`.
- Modern arXiv PDF URLs, including versions and optional `.pdf` suffixes.
- Direct HTTP(S) URLs whose pathname ends in `.pdf`, case-insensitively, including query parameters.

ArXiv PDF URLs are normalized to abstract URLs because the backend performs the final PDF conversion. Direct PDF query parameters are preserved. URL credentials are rejected. Unsupported complete web URLs receive guidance instead of being silently sent as questions. Legacy slash-style arXiv IDs and arbitrary publisher landing pages are outside the existing supported contract.

A question containing a URL alongside other text remains an ordinary question; merely pasting a link does not start a request until Enter or Send.

The import branch calls only the existing `importPaperFromUrl(url, signal)` helper:

```text
POST /import-url/
{ "pdf_url": "<supported URL>" }
```

No frontend user ID or token is placed in this body. The backend cookie determines ownership.

Ordinary questions still check that history is loaded/recovered and the selected paper is ready. The handler then uses the existing persistent conversation flow: create a conversation if needed, and send `{ question }` to `POST /conversations/{id}/messages`. It does not use the old paper ask endpoint. History recovery remains mandatory for another question, preventing a failed generation from causing an unexamined duplicate send.

## 5. Import loading, success and failure

While an import request is active, the existing banner shows **Importing your paper from its URL...**, the Send button shows its loading indicator, and duplicate submissions are blocked.

On success, `addAndSelectPaper()`:

1. Validates the returned paper ID and filename.
2. Deduplicates the paper into the local library.
3. Clears the previous conversation selection without deleting its server history.
4. Selects the imported paper and returns to Chat.
5. Opens its PDF preview on page 1 and clears library search.
6. Triggers the existing library refresh and retains the imported paper if a list response has not caught up.
7. Displays a success notice containing the returned paper status.

The current backend queues ingestion and returns `processing`; the frontend does not treat a queued PDF as ready. A response with no status now defaults conservatively to `processing`. The existing library poll runs every five seconds for pending statuses when no operation is busy. The active-paper bar/library reflect later `ready` or `failed` responses. Preview can open before ingestion finishes; ordinary questions require `ready`.

On failure, the shared API error is displayed, the original URL is restored to the textarea, the operation lock/loading state is released, and Enter/Send can retry. No paper or success response is fabricated. Session expiry still goes through existing authentication handling.

## 6. Chat recovery and independent imports

Previously, `chat.needsRecovery` disabled the entire composer and `ask()` returned before even checking whether the input was a URL. A failed history reload therefore prevented importing another paper.

The composer now remains usable in that recovery state. A complete supported URL can import independently and select the new paper. Ordinary questions still stop with a clear instruction to reload saved messages. Initial history loading and actively running operations still disable submission; this does not permit simultaneous message sends or bypass history recovery.

## 7. Verification and practical limits

Run from `frontend/`:

```powershell
npm run typecheck
npm run build
npm test
```

The existing Playwright suite uses controlled API fixtures and never sends real emails, creates production accounts, changes backend data, or invokes models. It covers startup/session isolation, valid and invalid authentication, pending verification, unrelated registration failures, keyboard/Send behavior, duplicate submission protection, loading/error/retry feedback, queued-to-ready status refresh, imports while recovering another chat, paper/PDF selection, stored conversation messages, citations, notes and responsive layout.

Live email delivery, verification-link handling, Supabase policies, publisher downloads and worker progress depend on the existing backend/environment. They were not modified or certified by frontend fixture tests. An accepted `processing` response requires the backend worker to eventually update the paper status; the frontend cannot perform ingestion itself.


## 8. Completion results

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: all 32 browser tests passed on the completed implementation.
- Desktop and mobile verification-confirmation screenshots were visually reviewed; the existing palette, card and notification styles are preserved.
- The existing delete-confirmation test now awaits dialog handling to avoid an asynchronous dialog race; production deletion behavior was not changed.
- Read-only hashes of all 31 backend source/configuration text files included in the starting snapshot matched after completion. No backend file was edited.
- No new runtime dependencies, API client, token storage, or test files were added.
