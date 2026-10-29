# PaperPilot frontend

React + TypeScript + Tailwind CSS, using Vite. The interface follows the ivory, white, and teal PaperPilot theme. Backend source files are unchanged.

## Run locally

From `frontend/`:

```powershell
npm install
npm run dev
```

Open the URL printed by Vite (normally http://127.0.0.1:5173).
Run your existing FastAPI server on port 8000 separately. Vite forwards `/api` requests to `http://127.0.0.1:8000`, avoiding development CORS changes. To use another port, copy `.env.example` to `.env` and change `API_PROXY_TARGET`, then restart Vite.

In **Settings**, enter the same `user_id` used for existing uploads. The initial value is `default`. This is a library selector, not authentication.

## Connected functionality

- PDF upload: `POST /uploadfile/` with `file` and `user_id` form fields. The interface waits for the existing synchronous processing to finish.
- Paper library: `GET /papers/?user_id=...`, with local title search and manual refresh.
- Questions: `POST /papers/{paper_id}/ask`, using the backend's actual answer, section/page citations, and confidence text. The API returns a complete answer, so the frontend does not simulate streaming.
- Summaries: requests a summary through the existing question endpoint; appears in chat.
- Notes: save answers with citations to browser local storage, delete, and export to Markdown. Notes are scoped by workspace ID but are not server-synchronized.
- PDF preview: object URLs for newly uploaded or manually attached local PDFs. Citations set the embedded viewer's page. The browser's PDF viewer must support page fragments. Attach the matching PDF again after a reload because the backend has no PDF serving endpoint. The UI does not invent source highlights or line numbers.

## Current boundaries

Chat history and PDF previews are session-only. Follow-up context is not sent because the existing API accepts only one question. Comparison is labeled as planned, since no multi-paper endpoint exists. No backend routes, authentication, graph display, arXiv import, or paper deletion were added. Empty directories such as the original frontend folder cannot be tracked by Git until populated.

## Production build

```powershell
npm run build
npm run preview
```

`dist/` contains the static build. The Vite proxy is development-only. Production hosting must reverse-proxy `/api` to the existing FastAPI server, or use `VITE_API_BASE_URL` with an API that allows the frontend origin. `vite preview` previews the static UI, not the development API proxy.

## Browser checks

```powershell
npx playwright install chromium
npm test
```

Alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an already installed Chrome executable before running `npm test`. Tests cover upload and question request contracts, evidence metadata, browser-persisted notes, Markdown export, API errors, and responsive navigation. They use mocked API responses and do not call a model or modify backend data. Screenshots are saved under the ignored project `tmp/` folder.

References: [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite), [Vite development proxy](https://vite.dev/config/server-options#server-proxy).
