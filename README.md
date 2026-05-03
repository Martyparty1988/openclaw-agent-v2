# 🤖 OpenClaw — Self-Improving AI Agent

WhatsApp + Telegram → Meta-Agent → Planner / Executor / Memory / SelfImprove → GitHub

## Architecture

```
WhatsApp ──┐
           ├──► router.js ──► meta-agent.js
Telegram ──┘                      │
                     ┌────────────┼────────────┬──────────────┐
                     ▼            ▼             ▼              ▼
                 planner      executor        memory      self-improve
                     │            │             │              │
                     │      bash/files/       JSON          analyze
                     │      fetch_url         files         refactor
                     └────────────┘             │            test
                                           agent-memory/   git commit
                                           *.json          → GitHub
```

## Files

```
router.js               ← Entry point. WhatsApp + Telegram.
meta-agent.js           ← Orchestrator. Parses commands, routes to sub-agents.
sub-agents/
  planner.js            ← Turns tasks into structured JSON execution plans.
  executor.js           ← Agentic loop: bash, read/write files, HTTP.
  memory.js             ← Per-user session persistence (JSON files).
  self-improve.js       ← Reads own code → refactors → tests → git commit.
agent-memory/           ← Auto-created. One JSON file per user.
```

## Setup

```bash
npm install
cp .env.example .env   # fill in OPENAI_API_KEY
npm start              # scan QR code to connect WhatsApp
```

## Quick Deploy (Railway)

1. Prepare env file and validate configuration:

```bash
cp .env.example .env
npm install
npm run deploy:check
```

2. Push the repo to GitHub and connect it in Railway.
3. In Railway Variables set at minimum:
   - `OPENAI_API_KEY`
   - `WA_PHONE_NUMBER` (without `+`, e.g. `420777123456`)
4. Optional: add `TELEGRAM_TOKEN` and `GIT_TOKEN` for Telegram + self-improve push.
5. Deploy using `railway.json` (`startCommand: node router.js`).

After first boot, read Railway logs and pair WhatsApp using the generated pairing code.

## Commands

| Command | Popis |
|---|---|
| `analyze <co>` | Analyzuj soubor nebo kód |
| `plan <úkol>` | Vytvoř plán |
| `execute <úkol>` | Spusť async, notifikace po dokončení |
| `improve` | 🧬 Self-improve: analyze → refactor → test → git push |
| `chat <zpráva>` | Volná konverzace s pamětí |
| `reset` | Smaž session paměť |

## Self-Improve Cycle (`improve`)

1. Přečte všechny zdrojové soubory agenta
2. Claude ohodnotí kvalitu kódu (1–10) a najde problémy
3. Vygeneruje opravené verze souborů
4. Spustí testy (`npm test` + syntax check)
5. Zapíše opravené soubory (`.bak` zálohy)
6. `git add → commit → push origin main`

## Git Setup

```bash
git init
git remote add origin https://github.com/your/repo.git
git config user.email "agent@openclaw.ai"
git config user.name "OpenClaw Agent"
```

## Platformy

- **WhatsApp** — Baileys, scan QR kódu
- **Telegram** — nastav `TELEGRAM_TOKEN` v `.env`

Obě platformy sdílí stejnou paměť a agenty. Telegram user ID má prefix `tg_`.
