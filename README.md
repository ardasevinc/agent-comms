# agent-comms

Bidirectional messaging between AI coding agents and humans via Telegram. Agents send messages from any machine, you read and reply in Telegram, replies route back to the right agent session.

See [docs/SPEC.md](docs/SPEC.md) for the full specification.

## Quick Start

```bash
bun install
```

### Service

```bash
export TELEGRAM_BOT_TOKEN=...  # from @BotFather
export TELEGRAM_CHAT_ID=...    # your chat ID
export API_KEY=...             # shared secret
bun run service
```

### CLI

Configure once:
```bash
export AGENT_COMMS_URL=https://agent-comms.your-domain.com
export AGENT_COMMS_API_KEY=your-shared-secret
```

Or create `~/.config/agent-comms/config.json`:
```json
{
  "serverUrl": "https://agent-comms.your-domain.com",
  "apiKey": "your-shared-secret"
}
```

Then:
```bash
agent-comms send "should I refactor this?"
agent-comms check                  # one-shot reply check
agent-comms watch                  # block until reply arrives
reply=$(agent-comms watch)         # capture reply in a variable
agent-comms history
```

### Tests

```bash
bun test
```

Optional live integration checks (skipped by default):
```bash
AGENT_COMMS_LIVE_TESTS=1 bun test src/__tests__/live.integration.test.ts
```
Optional overrides: `AGENT_COMMS_LIVE_URL`, `AGENT_COMMS_LIVE_API_KEY`.

## Stack

Bun, Hono, Grammy, Commander, bun:sqlite.
