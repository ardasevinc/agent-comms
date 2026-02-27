import { Database } from "bun:sqlite";
import type { AgentIdentity, Message } from "../shared/types.ts";

const DB_PATH = process.env.DATABASE_PATH ?? "./agent-comms.db";

const db = new Database(DB_PATH);

db.run("PRAGMA journal_mode=WAL");
db.run("PRAGMA busy_timeout=5000");

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    hostname TEXT NOT NULL,
    project TEXT NOT NULL,
    direction TEXT NOT NULL,
    content TEXT NOT NULL,
    telegram_message_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT
  )
`);

db.run(
	"CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, direction)",
);
db.run(
	"CREATE INDEX IF NOT EXISTS idx_messages_telegram ON messages(telegram_message_id)",
);

const insertStmt = db.prepare<
	{ id: number | bigint },
	[string, string, string, string, string, string]
>(`
  INSERT INTO messages (session_id, agent_type, hostname, project, direction, content)
  VALUES (?, ?, ?, ?, ?, ?)
  RETURNING id
`);

const updateTelegramIdStmt = db.prepare<void, [number, number | bigint]>(
	`UPDATE messages SET telegram_message_id = ? WHERE id = ?`,
);

const getUnreadRepliesStmt = db.prepare<Message, [string]>(`
  SELECT id, session_id as sessionId, agent_type as agentType, hostname, project,
         direction, content, telegram_message_id as telegramMessageId,
         created_at as createdAt, read_at as readAt
  FROM messages
  WHERE session_id = ? AND direction = 'human_to_agent' AND read_at IS NULL
  ORDER BY created_at ASC
`);

const getAndMarkUnreadRepliesStmt = db.prepare<Message, [string]>(`
  WITH unread AS (
    SELECT id
    FROM messages
    WHERE session_id = ? AND direction = 'human_to_agent' AND read_at IS NULL
  )
  UPDATE messages
  SET read_at = datetime('now')
  WHERE id IN (SELECT id FROM unread)
  RETURNING id, session_id as sessionId, agent_type as agentType, hostname, project,
            direction, content, telegram_message_id as telegramMessageId,
            created_at as createdAt, read_at as readAt
`);

const markReadStmt = db.prepare<void, [string]>(`
  UPDATE messages SET read_at = datetime('now')
  WHERE session_id = ? AND direction = 'human_to_agent' AND read_at IS NULL
`);

const getHistoryStmt = db.prepare<Message, [string, number]>(`
  SELECT id, session_id as sessionId, agent_type as agentType, hostname, project,
         direction, content, telegram_message_id as telegramMessageId,
         created_at as createdAt, read_at as readAt
  FROM messages
  WHERE session_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

const getByTelegramIdStmt = db.prepare<Message, [number]>(`
  SELECT id, session_id as sessionId, agent_type as agentType, hostname, project,
         direction, content, telegram_message_id as telegramMessageId,
         created_at as createdAt, read_at as readAt
  FROM messages
  WHERE telegram_message_id = ?
  LIMIT 1
`);

export function insertMessage(
	identity: AgentIdentity,
	direction: "agent_to_human" | "human_to_agent",
	content: string,
): number {
	const row = insertStmt.get(
		identity.sessionId,
		identity.agentType,
		identity.hostname,
		identity.project,
		direction,
		content,
	);
	return Number(row?.id);
}

export function setTelegramMessageId(
	messageId: number,
	telegramMessageId: number,
): void {
	updateTelegramIdStmt.run(telegramMessageId, messageId);
}

export function getUnreadReplies(sessionId: string): Message[] {
	return getUnreadRepliesStmt.all(sessionId);
}

export function getAndMarkUnreadReplies(sessionId: string): Message[] {
	const messages = getAndMarkUnreadRepliesStmt.all(sessionId);
	return messages.sort((a, b) => a.id - b.id);
}

export function markRepliesRead(sessionId: string): void {
	markReadStmt.run(sessionId);
}

export function getHistory(sessionId: string, limit = 20): Message[] {
	return getHistoryStmt.all(sessionId, limit);
}

export function getMessageByTelegramId(
	telegramMessageId: number,
): Message | null {
	return getByTelegramIdStmt.get(telegramMessageId) ?? null;
}

const getLastAgentMessageStmt = db.prepare<Message, []>(`
  SELECT id, session_id as sessionId, agent_type as agentType, hostname, project,
         direction, content, telegram_message_id as telegramMessageId,
         created_at as createdAt, read_at as readAt
  FROM messages
  WHERE direction = 'agent_to_human'
  ORDER BY id DESC
  LIMIT 1
`);

const getLastAgentMessageBySessionStmt = db.prepare<Message, [string]>(`
  SELECT id, session_id as sessionId, agent_type as agentType, hostname, project,
         direction, content, telegram_message_id as telegramMessageId,
         created_at as createdAt, read_at as readAt
  FROM messages
  WHERE direction = 'agent_to_human' AND session_id = ?
  ORDER BY id DESC
  LIMIT 1
`);

const getActiveSessionsStmt = db.prepare<
	{ sessionId: string; agentType: string; hostname: string; project: string },
	[]
>(`
  SELECT session_id as sessionId, agent_type as agentType, hostname, project
  FROM messages
  WHERE direction = 'agent_to_human'
  GROUP BY session_id
  ORDER BY MAX(id) DESC
  LIMIT 10
`);

export function getLastAgentMessage(): Message | null {
	return getLastAgentMessageStmt.get() ?? null;
}

export function getLastAgentMessageBySession(
	sessionId: string,
): Message | null {
	return getLastAgentMessageBySessionStmt.get(sessionId) ?? null;
}

export function getActiveSessions(): {
	sessionId: string;
	agentType: string;
	hostname: string;
	project: string;
}[] {
	return getActiveSessionsStmt.all();
}

export function clearMessages(): void {
	db.run("DELETE FROM messages");
}

export function insertReply(originalMessage: Message, content: string): number {
	const identity: AgentIdentity = {
		agentType: originalMessage.agentType as AgentIdentity["agentType"],
		sessionId: originalMessage.sessionId,
		hostname: originalMessage.hostname,
		project: originalMessage.project,
	};
	return insertMessage(identity, "human_to_agent", content);
}
