import { afterEach, describe, expect, test } from "bun:test";

// Env must be set before any service module imports
// DATABASE_PATH is already set by db.test.ts (same process),
// but set it here too in case this file runs first
if (!process.env.DATABASE_PATH) {
	process.env.DATABASE_PATH = `/tmp/agent-comms-api-test-${Date.now()}.db`;
}
process.env.API_KEY = "test-key";
process.env.TELEGRAM_BOT_TOKEN = "fake:token";
process.env.TELEGRAM_CHAT_ID = "12345";

const { app } = await import("../service/api.ts");
const { insertMessage, clearMessages } = await import("../service/db.ts");

const BASE = "http://localhost";

const identity = {
	agentType: "claude" as const,
	sessionId: "api-test-session",
	hostname: "test-host",
	project: "test-proj",
};

function req(path: string, options?: RequestInit) {
	return app.fetch(
		new Request(`${BASE}${path}`, {
			headers: {
				Authorization: "Bearer test-key",
				"Content-Type": "application/json",
				...((options?.headers as Record<string, string>) ?? {}),
			},
			...options,
		}),
	);
}

afterEach(() => {
	clearMessages();
});

describe("GET /health", () => {
	test("returns ok without auth", async () => {
		const res = await app.fetch(new Request(`${BASE}/health`));
		expect(res.status).toBe(200);
		const data = (await res.json()) as { ok: boolean };
		expect(data.ok).toBe(true);
	});
});

describe("auth", () => {
	test("rejects requests without auth header", async () => {
		const res = await app.fetch(new Request(`${BASE}/messages/some-session`));
		expect(res.status).toBe(401);
	});

	test("rejects requests with wrong key", async () => {
		const res = await app.fetch(
			new Request(`${BASE}/messages/some-session`, {
				headers: { Authorization: "Bearer wrong-key" },
			}),
		);
		expect(res.status).toBe(401);
	});
});

describe("POST /messages", () => {
	test("creates a message and returns id (telegram send fails gracefully)", async () => {
		const res = await req("/messages", {
			method: "POST",
			body: JSON.stringify({
				identity,
				content: "hello from test",
			}),
		});

		// Should still succeed — telegram failure is non-fatal
		expect(res.status).toBe(201);
		const data = (await res.json()) as {
			id: number;
			telegramMessageId: number | null;
		};
		expect(data.id).toBeGreaterThan(0);
		// Telegram send fails with fake token, so null
		expect(data.telegramMessageId).toBeNull();
	});

	test("rejects missing body fields", async () => {
		const res = await req("/messages", {
			method: "POST",
			body: JSON.stringify({ identity: null, content: "" }),
		});

		expect(res.status).toBe(400);
	});

	test("rejects invalid json body", async () => {
		const res = await app.fetch(
			new Request(`${BASE}/messages`, {
				method: "POST",
				headers: {
					Authorization: "Bearer test-key",
					"Content-Type": "application/json",
				},
				body: "{",
			}),
		);

		expect(res.status).toBe(400);
	});

	test("rejects malformed identity payload", async () => {
		const res = await req("/messages", {
			method: "POST",
			body: JSON.stringify({
				identity: {},
				content: "hello",
			}),
		});

		expect(res.status).toBe(400);
	});
});

describe("GET /messages/:sessionId", () => {
	test("returns empty array when no replies", async () => {
		const res = await req("/messages/nonexistent-session");
		expect(res.status).toBe(200);
		const data = (await res.json()) as { messages: unknown[] };
		expect(data.messages).toHaveLength(0);
	});

	test("returns unread replies and marks them read", async () => {
		insertMessage(identity, "human_to_agent", "reply text");

		const res = await req("/messages/api-test-session");
		const data = (await res.json()) as { messages: { content: string }[] };
		expect(data.messages).toHaveLength(1);
		expect(data.messages.at(0)?.content).toBe("reply text");

		// Second check should return empty (marked read)
		const res2 = await req("/messages/api-test-session");
		const data2 = (await res2.json()) as { messages: unknown[] };
		expect(data2.messages).toHaveLength(0);
	});

	test("mark_read=false preserves unread state", async () => {
		insertMessage(identity, "human_to_agent", "keep unread");

		const res = await req("/messages/api-test-session?mark_read=false");
		const data = (await res.json()) as { messages: unknown[] };
		expect(data.messages).toHaveLength(1);

		// Still unread
		const res2 = await req("/messages/api-test-session?mark_read=false");
		const data2 = (await res2.json()) as { messages: unknown[] };
		expect(data2.messages).toHaveLength(1);
	});
});

describe("GET /messages/:sessionId/history", () => {
	test("returns messages in both directions", async () => {
		insertMessage(identity, "agent_to_human", "question");
		insertMessage(identity, "human_to_agent", "answer");

		const res = await req("/messages/api-test-session/history");
		const data = (await res.json()) as { messages: unknown[] };
		expect(data.messages).toHaveLength(2);
	});

	test("respects limit query param", async () => {
		for (let i = 0; i < 10; i++) {
			insertMessage(identity, "agent_to_human", `msg ${i}`);
		}

		const res = await req("/messages/api-test-session/history?limit=3");
		const data = (await res.json()) as { messages: unknown[] };
		expect(data.messages).toHaveLength(3);
	});

	test("rejects invalid limit query param", async () => {
		const badRes = await req("/messages/api-test-session/history?limit=abc");
		expect(badRes.status).toBe(400);

		const negativeRes = await req(
			"/messages/api-test-session/history?limit=-1",
		);
		expect(negativeRes.status).toBe(400);
	});
});
