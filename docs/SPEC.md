# agent-comms Specification

Bidirectional messaging between AI coding agents and a human operator via Telegram.

## Problem

When running multiple AI agents (Claude Code, Codex) across machines — local laptop, VPSes, devboxes — there's no way for agents to ask questions, report status, or request decisions from the human. The human also can't push context back to a specific agent. This project solves that.

## Architecture

```
agent (any machine)                    devbox (dokku)                    human (telegram)
    │                                      │                                │
    │── agent-comms send "msg" ───────────>│                                │
    │   POST /messages                     │── bot.sendMessage() ──────────>│
    │                                      │                                │
    │                                      │<── swipe-reply ────────────────│
    │                                      │    (reply_to_message_id)       │
    │<── agent-comms check ────────────────│                                │
    │    GET /messages/:sessionId          │                                │
```

Four components:

1. **Service** — Single Bun process running Hono HTTP API + Grammy Telegram bot (long polling) + bun:sqlite. Deployed on devbox via Dokku.
2. **CLI** — Thin client installed on every machine where agents run. Auto-detects agent identity. Talks to the service over HTTP.
3. **Channel bridge** — Local stdio MCP server for Claude Code. Consumes the service SSE stream and emits `notifications/claude/channel` into the running session.
4. **Telegram bot** — Human-facing interface. Delivers agent messages, routes swipe-replies back to the correct agent session.

## Repo Layout

The repo is organized as Bun workspaces:

- `packages/shared`
- `packages/service`
- `packages/cli`
- `packages/channel`

## Agent Identity

Every message carries an `AgentIdentity` tuple, fully auto-detected by the CLI:

```typescript
interface AgentIdentity {
  agentType: "claude" | "codex" | "unknown";
  sessionId: string;   // unique per agent run
  hostname: string;    // machine name
  project: string;     // basename of cwd
}
```

### Detection Logic

**Agent type** (checked in order):
1. `$CLAUDECODE === "1"` → `"claude"`
2. `$CODEX_THREAD_ID` is set → `"codex"`
3. Otherwise → `"unknown"`

**Session ID** (checked in order):
1. `$CLAUDE_SESSION_ID` — set by a SessionStart hook that injects it into the env
2. `$CODEX_THREAD_ID` — automatically injected by Codex into all subprocess envs
3. `basename $(readlink ~/.claude/debug/latest) .txt` — fallback for Claude Code without the hook. Validated with an `includes("-")` check to ensure it's a UUID-shaped string; if not, falls through.
4. `crypto.randomUUID()` — last resort fallback

**Hostname**: `os.hostname()`

**Project**: `path.basename(process.cwd())`

### Session Scoping

Each agent run produces a unique session ID. Two Codex instances on the same machine working on the same project get different sessions because `$CODEX_THREAD_ID` differs per thread. A new Claude Code session gets a new debug symlink target.

Messages and replies are scoped to sessions. When an agent dies and a new one starts, the new agent gets a fresh inbox — it won't see replies intended for the dead agent's conversation.

## API

Base URL: `https://<your-domain>` (configured via `AGENT_COMMS_URL`).

Auth: `Authorization: Bearer <API_KEY>` on all endpoints except `/health`.

### `POST /messages`

Agent sends a message to the human.

**Request:**
```json
{
  "identity": {
    "agentType": "claude",
    "sessionId": "9e92e107-62b8-4b79-8720-89ddb55842c6",
    "hostname": "mbp-arda",
    "project": "agent-comms"
  },
  "content": "Should I use Redis or SQLite for the cache layer?"
}
```

**Response (201):**
```json
{
  "id": 42,
  "telegramMessageId": 1337
}
```

`telegramMessageId` is `null` if Telegram delivery failed (message is still persisted).

### `GET /messages/:sessionId`

Check for unread replies from the human.

**Query params:**
- `mark_read` — `"true"` (default) or `"false"`. When true, returned messages are atomically marked as read.

**Response (200):**
```json
{
  "messages": [
    {
      "id": 43,
      "sessionId": "9e92e107-...",
      "agentType": "claude",
      "hostname": "mbp-arda",
      "project": "agent-comms",
      "direction": "human_to_agent",
      "content": "Use SQLite, keep it simple",
      "telegramMessageId": null,
      "createdAt": "2026-02-28 12:34:56",
      "readAt": "2026-02-28 12:35:00"
    }
  ]
}
```

Returns empty array when no unread messages exist.

### `GET /messages/:sessionId/stream`

Server-Sent Events endpoint for real-time inbound delivery.

- Auth: same bearer token as the rest of the API
- Event type: `message`
- Heartbeat: `event: heartbeat`
- Reconnect cursor: `Last-Event-ID`

This route is consumed by the local Claude Code channel bridge. Polling commands (`check` / `watch`) still use the JSON endpoints.

### `GET /messages/:sessionId/history`

Full conversation history for a session (both directions).

**Query params:**
- `limit` — number of messages to return (default `20`). Most recent first.

**Response (200):**
```json
{
  "messages": [
    { "direction": "human_to_agent", "content": "Use SQLite", ... },
    { "direction": "agent_to_human", "content": "Should I use Redis or SQLite?", ... }
  ]
}
```

### `GET /health`

No auth required. Returns `{ "ok": true }`.

## Telegram Message Format

Agent messages appear in Telegram as:

```
[claude] mbp-arda / agent-comms

Should I use Redis or SQLite for the cache layer?
```

Format: `[agentType]` in bold, followed by `hostname / project`, then the message body. HTML parse mode. Each message includes an inline **"Reply" button** for quick replies without scrolling.

### Reply Routing

Three ways to reply, checked in this order:

**1. Swipe-reply** (native Telegram reply-to-message):
- Bot reads `reply_to_message.message_id` from the update
- Looks up the original message by `telegram_message_id`
- Inserts reply scoped to that message's session
- If mapping is missing, bot replies with an error and does **not** fall back to last-agent routing

**2. Inline "Reply" button**:
- Each agent message has a "Reply" button attached via inline keyboard
- Tapping it stores the target session and shows a callback toast: `Next message → [agent]`
- The next plain text message routes to that session
- If the selected session is stale/invalid, bot fails loudly and does **not** fall back to last-agent routing

**3. Plain text (last-agent default)**:
- Plain text with no swipe-reply and no pending-target routes to the **most recent agent that messaged**
- Simplest path for single-agent conversations

All successful replies are confirmed with a 👍 reaction on the human's message (no confirmation text cluttering the chat).

### `/reply` Command

Typing `/reply` shows an inline keyboard with all active agent sessions (up to 10, most recent first). Tap one to select it as the reply target, then type your message.

### Bot Commands

| Command  | Description                              |
|----------|------------------------------------------|
| `/reply` | Show active sessions to pick a reply target |

## CLI

### Commands

```bash
agent-comms send <message>           # fire-and-forget, prints message ID
agent-comms check                    # get unread replies, marks them read
agent-comms history [-l, --limit N]  # show recent conversation (default 20)
agent-comms watch                    # block until a reply arrives, then exit
agent-comms channel serve            # stdio MCP bridge for Claude Code channels
```

#### `watch` options

| Flag | Default | Description |
|------|---------|-------------|
| `--interval <seconds>` | `15` | How often to poll for replies |
| `--timeout <seconds>` | none | Give up after N seconds (exits 1). Omit for infinite wait. |
| `--continuous` | off | Don't exit on first reply — keep printing new ones as they arrive |

### Configuration

Resolved in order (first match wins):

1. Environment variables (including `.env` — Bun loads `.env` files automatically)
2. Config file at `~/.config/agent-comms/config.json`

| Setting    | Env var              | Config file key |
|------------|----------------------|-----------------|
| Server URL | `AGENT_COMMS_URL`    | `serverUrl`     |
| API key    | `AGENT_COMMS_API_KEY`| `apiKey`        |

Config file location: `~/.config/agent-comms/config.json`

```json
{
  "serverUrl": "https://agent-comms.your-domain.com",
  "apiKey": "your-shared-secret"
}
```

### CLI Output

**`send`**: `Sent (id: 42)`

**`check`** (with messages):
```
[2026-02-28 12:34:56] Use SQLite, keep it simple
```

**`check`** (no messages): `No new messages.`

**`history`**:
```
→ [2026-02-28 12:30:00] Should I use Redis or SQLite?
← [2026-02-28 12:34:56] Use SQLite, keep it simple
```

`→` = agent to human, `←` = human to agent.

**`watch`** (reply received):
- stdout: reply content only (capturable via `$()`)
- stderr: status lines like `Waiting for reply... (checking every 15s)`

**`watch`** (timeout expired):
- stderr: `Timed out waiting for reply.`
- exit code: `1`

**`watch --continuous`** (ongoing):
- prints each reply to stdout as it arrives, never exits on its own

## Database

Single SQLite file. Location: `$DATABASE_PATH` or `./agent-comms.db`.

Pragmas: `journal_mode=WAL`, `busy_timeout=5000`.

### Schema

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  hostname TEXT NOT NULL,
  project TEXT NOT NULL,
  direction TEXT NOT NULL,         -- 'agent_to_human' | 'human_to_agent'
  content TEXT NOT NULL,
  telegram_message_id INTEGER,     -- routing key for reply mapping
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT                     -- null = unread
);

CREATE INDEX idx_messages_session ON messages(session_id, direction);
CREATE INDEX idx_messages_telegram ON messages(telegram_message_id);
```

No sessions table. A session implicitly exists when messages reference its ID. No TTL — messages persist indefinitely.

The `telegram_message_id` column is the critical routing key. When the bot forwards an agent message to Telegram, the returned `message_id` is stored here. When a human replies, the bot looks up `reply_to_message.message_id` against this column to find which session to route the reply to.

## Environment Variables

Bun automatically loads `.env` files from the project root. Copy `.env.example` to `.env` and fill in the values. No dotenv library needed.

### Service

| Variable             | Required | Default              | Description                    |
|----------------------|----------|----------------------|--------------------------------|
| `TELEGRAM_BOT_TOKEN` | Yes      | —                    | Bot token from @BotFather      |
| `TELEGRAM_CHAT_ID`   | Yes      | —                    | Your Telegram chat ID          |
| `API_KEY`            | Yes      | —                    | Shared secret for API auth     |
| `DATABASE_PATH`      | No       | `./agent-comms.db`   | SQLite file path               |
| `PORT`               | No       | `3000`               | HTTP server port               |

### CLI

| Variable             | Required | Default | Description                           |
|----------------------|----------|---------|---------------------------------------|
| `AGENT_COMMS_URL`    | Yes*     | —       | Service URL                           |
| `AGENT_COMMS_API_KEY`| Yes*     | —       | Shared secret                         |

*Can also be set via `~/.config/agent-comms/config.json`.

## Deployment (Dokku)

```bash
dokku apps:create agent-comms
dokku storage:ensure-directory agent-comms-data
dokku storage:mount agent-comms /var/lib/dokku/data/storage/agent-comms-data:/data
dokku config:set agent-comms \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_CHAT_ID=... \
  API_KEY=... \
  DATABASE_PATH=/data/agent-comms.db
```

The Dockerfile uses `oven/bun:1`, runs TypeScript directly (no build step), and exposes port 3000.

## Project Structure

```
agent-comms/
├── src/
│   ├── service/
│   │   ├── index.ts          # wires Hono + Grammy, exports Bun server
│   │   ├── api.ts            # Hono routes + auth middleware
│   │   ├── bot.ts            # Grammy bot, reply handler, sendToTelegram()
│   │   └── db.ts             # SQLite schema, prepared statements, all queries
│   ├── cli/
│   │   ├── index.ts          # #!/usr/bin/env bun, Commander setup
│   │   ├── commands/
│   │   │   ├── send.ts       # POST /messages
│   │   │   ├── check.ts      # GET /messages/:sessionId
│   │   │   ├── history.ts    # GET /messages/:sessionId/history
│   │   │   └── watch.ts      # poll until reply arrives, then exit
│   │   ├── identity.ts       # agent type + session ID auto-detection
│   │   └── config.ts         # env var / config file resolution
│   ├── shared/
│   │   └── types.ts          # AgentIdentity, Message, request/response types
│   └── __tests__/
│       ├── db.test.ts        # SQLite layer tests
│       ├── api.test.ts       # HTTP route tests
│       └── identity.test.ts  # Identity detection tests
├── Dockerfile
├── biome.json
├── package.json
└── tsconfig.json
```

## Dependencies

| Package     | Purpose         |
|-------------|-----------------|
| `grammy`    | Telegram bot    |
| `hono`      | HTTP server     |
| `commander` | CLI parsing     |
| `bun:sqlite`| Database (built-in) |

## Agent Instructions Template

Add to your global `CLAUDE.md` or `AGENTS.md` to make agents aware of this tool:

```markdown
## Agent Communication

You have access to `agent-comms`, a CLI tool for messaging the human operator.

**When to use it:**
- You need a decision or clarification that blocks progress
- You've completed a significant milestone worth reporting
- You've encountered an unexpected situation

**Commands:**
- `agent-comms send "your message"` — send a message (fire-and-forget)
- `agent-comms check` — check for replies from the human (one-shot)
- `agent-comms watch` — block until a reply arrives, then exit (stdout = reply content)
- `agent-comms history` — view recent conversation

**Waiting for a reply:**
```bash
agent-comms send "should I use Redis or SQLite?"
reply=$(agent-comms watch)   # blocks until human responds
# use $reply
```

`watch` polls indefinitely by default — the human can take as long as needed.
Use `--timeout <seconds>` to give up after a set time (exits with code 1).
Use `--continuous` to keep printing replies without exiting (monitoring mode).
```

## Design Decisions

**Why Telegram?** Push notifications on mobile for free. Familiar chat UI. Reply threading is native. No custom frontend to build.

**Why long polling over webhooks?** No need to expose a public HTTPS endpoint on the devbox. Simpler deployment. Latency is ~1-2s, acceptable for async agent comms.

**Why a single `messages` table?** Both directions use the same schema. The `direction` field distinguishes them. Keeps queries simple and avoids joins.

**Why pull-only (no context injection)?** Injecting messages into an agent's context without it asking can cause confusion — the agent might misinterpret out-of-context replies. Agents check when they're ready.

**Why single shared API key?** This is a single-user tool. Per-agent keys add complexity with no security benefit when you control all the machines.

**Why `id DESC` instead of `created_at DESC` for history?** Messages inserted within the same second have identical `created_at` values. `id` is monotonically increasing and deterministic.

**Why three reply mechanisms?** Swipe-reply is precise but requires scrolling to find the message. Inline Reply buttons solve this for recent messages. Plain-text-to-last-agent is the zero-friction path for the common case of one active agent. The `/reply` command handles the multi-agent picker case. Layering all three covers every UX scenario.

**Why reactions instead of confirmation messages?** Confirmation messages like "Sent to [claude] ..." clutter the chat fast, especially with multiple agents. A 👍 reaction on the human's message is silent confirmation that doesn't add noise.

**Why `watch` instead of a bash loop with a timeout?** Fixed-timeout polling loops mean agents silently give up if the human doesn't respond in the window — common when the human is busy or asleep. `watch` polls indefinitely by default, on the human's schedule. The `--timeout` flag is opt-in for cases where giving up after a set time makes sense. stdout/stderr separation makes reply content directly capturable via `$()`.
