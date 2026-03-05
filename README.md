# OpenClaw Agent v2

Multi-agent orchestrator (Planner, Executor, Memory, SelfImprove, WebImprove, QA, TaskManager) with web control panel.

## Local start

```bash
npm start
```

Backend runs on `http://localhost:3000` and serves API + local web panel.

## Commands

- `qa` — syntax/health checks
- `tasks` — list saved tasks
- `done all` / `ukonci vsechny ulohy` — close all user tasks
- `execute <task>` — execute task asynchronously

## Railway backend deploy

1. Deploy this repository to Railway.
2. Keep `railway.json` in root (uses `npm start`, healthcheck `/health`).
3. Set variables as needed:
   - `ANTHROPIC_API_KEY`
   - `WA_PHONE_NUMBER` (if WhatsApp is used)
   - `TELEGRAM_TOKEN` (optional)
4. After deploy, verify:
   - `GET https://<railway-domain>/health`
   - `POST https://<railway-domain>/api/message`

## Vercel autonomous frontend deploy

1. Create a separate Vercel project with **Root Directory = `web`**.
2. Deploy static frontend (`web/vercel.json` included).
3. Open Vercel URL and set **Backend API URL** in the UI to your Railway backend domain, e.g.:
   - `https://openclaw-api.up.railway.app`
4. Frontend persists this backend URL to `localStorage`, so it remains autonomous and reusable between sessions.

## API

- `POST /api/message`
  - body: `{ "userId": "web_admin", "text": "qa" }`
  - response: `{ "ok": true, "replies": ["..."] }`
- `GET /health`
  - response: `{ "ok": true, "service": "openclaw-web-control" }`
