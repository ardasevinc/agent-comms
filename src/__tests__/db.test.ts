import { afterEach, describe, expect, test } from "bun:test";

// Set DATABASE_PATH before importing db module
const TEST_DB = `/tmp/agent-comms-test-${Date.now()}.db`;
process.env.DATABASE_PATH = TEST_DB;

// Also set required env vars for bot.ts (imported transitively)
process.env.TELEGRAM_BOT_TOKEN = "fake:token";
process.env.TELEGRAM_CHAT_ID = "12345";
process.env.API_KEY = "test-key";

const {
	insertMessage,
	setTelegramMessageId,
	getUnreadReplies,
	markRepliesRead,
	getHistory,
	getMessageByTelegramId,
	insertReply,
	clearMessages,
} = await import("../service/db.ts");

const identity = {
	agentType: "claude" as const,
	sessionId: "test-session-123",
	hostname: "test-host",
	project: "test-project",
};

afterEach(() => {
	clearMessages();
});

describe("insertMessage", () => {
	test("inserts and returns an id", () => {
		const id = insertMessage(identity, "agent_to_human", "hello arda");
		expect(id).toBeGreaterThan(0);
	});

	test("stores all identity fields", () => {
		insertMessage(identity, "agent_to_human", "test msg");
		const [msg] = getHistory("test-session-123", 1);
		expect(msg).toBeDefined();
		expect(msg?.sessionId).toBe("test-session-123");
		expect(msg?.agentType).toBe("claude");
		expect(msg?.hostname).toBe("test-host");
		expect(msg?.project).toBe("test-project");
		expect(msg?.direction).toBe("agent_to_human");
		expect(msg?.content).toBe("test msg");
	});
});

describe("telegram message id", () => {
	test("setTelegramMessageId updates the row", () => {
		const id = insertMessage(identity, "agent_to_human", "hello");
		setTelegramMessageId(id, 99999);

		const found = getMessageByTelegramId(99999);
		expect(found).not.toBeNull();
		expect(found?.content).toBe("hello");
		expect(found?.sessionId).toBe("test-session-123");
	});

	test("getMessageByTelegramId returns null for unknown id", () => {
		const found = getMessageByTelegramId(777);
		expect(found).toBeNull();
	});
});

describe("replies", () => {
	test("getUnreadReplies returns only unread human_to_agent messages", () => {
		insertMessage(identity, "agent_to_human", "question?");
		insertMessage(identity, "human_to_agent", "answer!");
		insertMessage(identity, "human_to_agent", "also this");

		const replies = getUnreadReplies("test-session-123");
		expect(replies).toHaveLength(2);
		expect(replies.at(0)?.content).toBe("answer!");
		expect(replies.at(1)?.content).toBe("also this");
	});

	test("markRepliesRead marks all unread replies", () => {
		insertMessage(identity, "human_to_agent", "reply 1");
		insertMessage(identity, "human_to_agent", "reply 2");

		markRepliesRead("test-session-123");

		const replies = getUnreadReplies("test-session-123");
		expect(replies).toHaveLength(0);
	});

	test("replies are scoped to session", () => {
		insertMessage(identity, "human_to_agent", "for session 123");

		const other = { ...identity, sessionId: "other-session" };
		insertMessage(other, "human_to_agent", "for other session");

		const replies = getUnreadReplies("test-session-123");
		expect(replies).toHaveLength(1);
		expect(replies.at(0)?.content).toBe("for session 123");
	});
});

describe("history", () => {
	test("returns messages in both directions, most recent first", () => {
		insertMessage(identity, "agent_to_human", "first");
		insertMessage(identity, "human_to_agent", "second");
		insertMessage(identity, "agent_to_human", "third");

		const msgs = getHistory("test-session-123");
		expect(msgs).toHaveLength(3);
		expect(msgs.at(0)?.content).toBe("third");
		expect(msgs.at(2)?.content).toBe("first");
	});

	test("respects limit", () => {
		for (let i = 0; i < 10; i++) {
			insertMessage(identity, "agent_to_human", `msg ${i}`);
		}

		const msgs = getHistory("test-session-123", 3);
		expect(msgs).toHaveLength(3);
	});
});

describe("insertReply", () => {
	test("creates a human_to_agent message with original session context", () => {
		const id = insertMessage(identity, "agent_to_human", "question");
		setTelegramMessageId(id, 12345);

		const original = getMessageByTelegramId(12345);
		expect(original).not.toBeNull();
		insertReply(original!, "the answer");

		const replies = getUnreadReplies("test-session-123");
		expect(replies).toHaveLength(1);
		expect(replies.at(0)?.content).toBe("the answer");
		expect(replies.at(0)?.direction).toBe("human_to_agent");
	});
});
