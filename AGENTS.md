# agent-comms

Async messaging bridge between AI agents (Claude Code, Codex) and a human operator via Telegram.

**Two independent entry points** — service runs continuously on a server; CLI is installed on agent machines as a stateless binary.

## Dev commands

```
bun run service       # start the service (requires env vars below)
bun run cli           # run CLI locally
bun test              # run all tests
bun run lint          # biome check + autofix
```

## Env vars

**Service** (`src/service/`):
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — bot credentials
- `API_KEY` — shared bearer secret
- `DATABASE_PATH` — sqlite file (default: `./agent-comms.db`)
- `PORT` — http port (default: `3000`)

**CLI** (`src/cli/`):
- `AGENT_COMMS_URL`, `AGENT_COMMS_API_KEY` — or configure via `agent-comms config init` → `~/.config/agent-comms/config.json`

## Invariants

- Single `messages` table for both directions. `direction` is `agent_to_human` | `human_to_agent`.
- `telegram_message_id` is the reply routing key. It must be stored on outbound messages and never defaulted — the bot's reply routing breaks silently without it.
- Session ID is **auto-detected** by the CLI (from `CLAUDE_SESSION_ID`, `CODEX_THREAD_ID`, or `~/.claude/debug/latest`). Agents don't pass it manually.
- Service runs TypeScript directly — no build step. CLI has a compiled binary release for agent machines (see `.github/workflows/`).

## Tests

Each suite creates a temp sqlite file and restores env vars on teardown. Run a single suite: `bun test src/__tests__/foo.test.ts`.
