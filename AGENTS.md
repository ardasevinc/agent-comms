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

## CLI commands

```
agent-comms send "msg"       # fire-and-forget, prints ID
agent-comms check            # one-shot unread reply check
agent-comms watch            # block until reply arrives, exit 0 (stdout = content)
agent-comms watch --timeout 300   # give up after 5 min, exit 1
agent-comms watch --continuous    # keep printing replies, never exits on its own
agent-comms history          # recent conversation
```

## Env vars

**Service** (`src/service/`):
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — bot credentials
- `API_KEY` — shared bearer secret
- `DATABASE_PATH` — sqlite file (default: `./agent-comms.db`)
- `PORT` — http port (default: `3000`)

**CLI** (`src/cli/`):
- `AGENT_COMMS_URL`, `AGENT_COMMS_API_KEY` — or configure via `agent-comms config init` → `~/.config/agent-comms/config.json`

## Waiting for a reply (canonical pattern)

```bash
agent-comms send "question here"
reply=$(agent-comms watch)   # stdout = reply content, stderr = status
# process $reply
```

## Invariants

- Single `messages` table for both directions. `direction` is `agent_to_human` | `human_to_agent`.
- `telegram_message_id` is the reply routing key. It must be stored on outbound messages and never defaulted — the bot's reply routing breaks silently without it.
- Session ID is **auto-detected** by the CLI (from `CLAUDE_SESSION_ID`, `CODEX_THREAD_ID`, or `~/.claude/debug/latest`). Agents don't pass it manually.
- Service runs TypeScript directly — no build step. CLI has a compiled binary release for agent machines (see `.github/workflows/`).

## Pitfalls

- **`identity.test.ts` fails inside Claude Code sessions.** The "detects codex agent type" test expects `CODEX_THREAD_ID` to win, but `CLAUDE_SESSION_ID` is set in env and takes priority. Pre-existing, not a regression — ignore it in CI-from-agent contexts.
- **`--interval 0` is allowed internally but blocked at CLI.** The `watch()` function accepts 0 (tests rely on this to avoid real sleeps). The CLI rejects `< 1`. Don't "fix" the function to enforce >= 1 or you'll break all watch tests.
- **Config file contains the API key in plaintext.** `~/.config/agent-comms/config.json` should be 0600. `config init` enforces this, but if you create it manually, you must set permissions yourself.

## Tests

Each suite creates a temp sqlite file and restores env vars on teardown. Run a single suite: `bun test src/__tests__/foo.test.ts`.
