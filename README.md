# 🤖 OpenClaw — Self-Improving AI Agent

WhatsApp + Telegram → Meta-Agent → Planner / Executor / Memory / SelfImprove → GitHub

## Current default mode

OpenClaw now defaults to the free OpenRouter router:

```bash
LLM_PROVIDER=openrouter
OPENROUTER_MODEL=openrouter/free
```

`openrouter/free` automatically selects from currently available free OpenRouter models. It is best for testing, learning, personal bots, and low-volume use. Free models can have lower rate limits, variable availability, and slower responses during peak hours.

Important: in this version, OpenRouter and OpenAI modes are text-only for execution. They can plan, chat, analyze, and generate patch instructions, but they do not directly run bash or edit files. Full tool-calling execution is available in Anthropic mode.

## Architecture

```
WhatsApp ──┐
           ├──► router.js ──► meta-agent.js
Telegram ──┘                      │
                     ┌────────────┼────────────┬──────────────┐
                     ▼            ▼             ▼              ▼
                 planner      executor        memory      self-improve
                     │            │             │              │
                     │      guarded tools      JSON          analyze
                     │      bash/files/HTTP    files         refactor
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
  executor.js           ← Agentic loop. Bash/write are disabled by default for safety.
  memory.js             ← Per-user session persistence (JSON files).
  self-improve.js       ← Reads own code → refactors → tests → git commit.
agent-memory/           ← Auto-created. One JSON file per user.
```

## Setup

```bash
npm install
cp .env.example .env
npm start
```

## Free AI mode — recommended first setup

Create an OpenRouter API key, then set:

```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openrouter/free
```

This is the easiest free setup. You still need an API key, but the model routing itself uses free models.

## Full tools mode — paid/advanced

For the real agent executor with Anthropic tool calling:

```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-3-5-sonnet-20241022
```

Bash and write tools remain disabled by default. Enable them only on trusted private deployments:

```bash
ALLOW_AGENT_BASH=true
ALLOW_AGENT_WRITE=true
```

## Telegram / WhatsApp

Telegram:

```bash
TELEGRAM_TOKEN=your-botfather-token
```

WhatsApp:

```bash
WA_PHONE_NUMBER=420777123456
```

You can run Telegram-only, WhatsApp-only, or both.

## Access control

This is a private bot. Keep the allowlist on:

```bash
ALLOW_ALL_USERS=false
ALLOWED_TELEGRAM_CHAT_IDS=123456789
ALLOWED_WHATSAPP_NUMBERS=420777123456
```

To discover your Telegram chat ID, temporarily start the bot without the allowlist and check Railway logs for blocked user IDs, or use a Telegram ID helper bot. Then add the ID to Railway Variables.

## Quick Deploy (Railway)

1. Push the repo to GitHub and connect it in Railway.
2. Add Railway Variables:
   - `LLM_PROVIDER=openrouter`
   - `OPENROUTER_API_KEY=...`
   - `OPENROUTER_MODEL=openrouter/free`
   - `TELEGRAM_TOKEN=...` and/or `WA_PHONE_NUMBER=...`
   - `ALLOWED_TELEGRAM_CHAT_IDS=...` and/or `ALLOWED_WHATSAPP_NUMBERS=...`
3. Run:

```bash
npm run deploy:check
```

4. Deploy using `railway.json` (`startCommand: node router.js`).

## Commands

| Command | Popis |
|---|---|
| `status` | Ukáže provider, model a zapnuté platformy |
| `analyze <co>` | Analyzuje soubor nebo kód |
| `plan <úkol>` | Vytvoří plán |
| `execute <úkol>` | Spustí agenta async |
| `improve` | Self-improve cyklus |
| `chat <zpráva>` | Volná konverzace s pamětí |
| `reset` | Smaže session paměť |

## Security notes

Never commit real `.env` files. Real secrets belong in Railway Variables or a password manager. If any token was ever committed or pasted into chat, rotate it.

`.gitignore` excludes `.env`, runtime memory, backups, logs, and build outputs.
