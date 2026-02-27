import { afterEach, describe, expect, test } from "bun:test";

const TEST_DB = `/tmp/agent-comms-bot-test-${Date.now()}.db`;
process.env.DATABASE_PATH = TEST_DB;
process.env.TELEGRAM_BOT_TOKEN = "fake:token";
process.env.TELEGRAM_CHAT_ID = "12345";
process.env.API_KEY = "test-key";

const { insertMessage, setTelegramMessageId, clearMessages } = await import(
	"../service/db.ts"
);
const {
	resolveReplyTarget,
	__testOnly_clearPendingReplies,
	__testOnly_setPendingReply,
} = await import("../service/bot.ts");

const agentA = {
	agentType: "claude" as const,
	sessionId: "session-a",
	hostname: "host-a",
	project: "proj-a",
};

const agentB = {
	agentType: "codex" as const,
	sessionId: "session-b",
	hostname: "host-b",
	project: "proj-b",
};

afterEach(() => {
	__testOnly_clearPendingReplies();
	clearMessages();
});

describe("resolveReplyTarget", () => {
	test("fails loudly when swipe-reply mapping does not exist", () => {
		insertMessage(agentA, "agent_to_human", "latest from A");

		const result = resolveReplyTarget({
			replyToMessageId: 999999,
			fromUserId: 1,
		});

		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.message).toContain(
				"Couldn't find the original agent message",
			);
		}
	});

	test("routes swipe-reply to mapped original message", () => {
		const id = insertMessage(agentA, "agent_to_human", "hello");
		setTelegramMessageId(id, 1234);

		const result = resolveReplyTarget({
			replyToMessageId: 1234,
			fromUserId: 1,
		});

		expect(result.kind).toBe("deliver");
		if (result.kind === "deliver") {
			expect(result.message.sessionId).toBe("session-a");
		}
	});

	test("fails loudly when pending session is stale and does not reroute", () => {
		insertMessage(agentA, "agent_to_human", "latest from A");
		__testOnly_setPendingReply(1, "missing-session");

		const result = resolveReplyTarget({ fromUserId: 1 });
		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.message).toContain("Reply target is no longer active");
		}
	});

	test("uses pending session when valid", () => {
		insertMessage(agentA, "agent_to_human", "from A");
		insertMessage(agentB, "agent_to_human", "latest from B");
		__testOnly_setPendingReply(1, "session-a");

		const result = resolveReplyTarget({ fromUserId: 1 });
		expect(result.kind).toBe("deliver");
		if (result.kind === "deliver") {
			expect(result.message.sessionId).toBe("session-a");
		}
	});

	test("falls back to most recent agent when no reply context exists", () => {
		insertMessage(agentA, "agent_to_human", "older");
		insertMessage(agentB, "agent_to_human", "newer");

		const result = resolveReplyTarget({ fromUserId: 1 });
		expect(result.kind).toBe("deliver");
		if (result.kind === "deliver") {
			expect(result.message.sessionId).toBe("session-b");
		}
	});
});
