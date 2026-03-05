# OpenClaw Agent v2

Multi-agent orchestrator (Planner, Executor, Memory, SelfImprove, WebImprove, QA, TaskManager) with a new web control panel.

## Start

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## New features

- **Web Control Panel**: send commands, run quick actions, watch responses in real time.
- **QA Agent** (`qa`): runs built-in syntax and health checks.
- **TaskManager Agent** (`tasks`, `done all`): stores task history and allows closing all tasks.
- **Improved MetaAgent routing**: includes new commands and cleaner help output.

## API

- `POST /api/message`
  - body: `{ "userId": "web_admin", "text": "qa" }`
  - response: `{ "ok": true, "replies": ["..."] }`

- `GET /health`
  - response: `{ "ok": true, "service": "openclaw-web-control" }`
