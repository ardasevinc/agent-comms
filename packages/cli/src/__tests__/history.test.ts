import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.AGENT_COMMS_URL = "http://test-service";
process.env.AGENT_COMMS_API_KEY = "test-key";

const { history } = await import("../commands/history.ts");

function makeHistoryResponse(
	messages: Array<{
		id: number;
		sessionId: string;
		agentType: string;
		hostname: string;
		project: string;
		direction: "agent_to_human" | "human_to_agent";
		content: string;
		telegramMessageId: number | null;
		createdAt: string;
		readAt: string | null;
	}>,
) {
	return new Response(JSON.stringify({ messages }), { status: 200 });
}

function errorResponse(status: number, body: string) {
	return new Response(body, { status });
}

function setMockFetch(handler: () => Promise<Response>) {
	globalThis.fetch = handler as unknown as typeof fetch;
}

describe("history", () => {
	let originalFetch: typeof globalThis.fetch;
	let stdout: string[];
	let stderr: string[];

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		stdout = [];
		stderr = [];
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const out = (s: string) => stdout.push(s);
	const err = (s: string) => stderr.push(s);

	test("returns 1 for invalid limit and does not call fetch", async () => {
		let calls = 0;
		setMockFetch(async () => {
			calls++;
			return makeHistoryResponse([]);
		});

		const code = await history({ limit: "abc" }, out, err);

		expect(code).toBe(1);
		expect(calls).toBe(0);
		expect(stderr.some((s) => s.includes("Invalid --limit"))).toBe(true);
	});

	test("returns 1 for negative limit and does not call fetch", async () => {
		let calls = 0;
		setMockFetch(async () => {
			calls++;
			return makeHistoryResponse([]);
		});

		const code = await history({ limit: "-1" }, out, err);

		expect(code).toBe(1);
		expect(calls).toBe(0);
		expect(stderr.some((s) => s.includes("Invalid --limit"))).toBe(true);
	});

	test("prints no-message notice when session history is empty", async () => {
		setMockFetch(async () => makeHistoryResponse([]));

		const code = await history({ limit: "20" }, out, err);

		expect(code).toBe(0);
		expect(stdout).toEqual(["No messages in this session.\n"]);
		expect(stderr).toEqual([]);
	});

	test("prints history oldest-first with direction arrows", async () => {
		setMockFetch(async () =>
			makeHistoryResponse([
				{
					id: 2,
					sessionId: "s",
					agentType: "claude",
					hostname: "h",
					project: "p",
					direction: "human_to_agent",
					content: "answer",
					telegramMessageId: null,
					createdAt: "2026-01-01 00:01:00",
					readAt: null,
				},
				{
					id: 1,
					sessionId: "s",
					agentType: "claude",
					hostname: "h",
					project: "p",
					direction: "agent_to_human",
					content: "question",
					telegramMessageId: null,
					createdAt: "2026-01-01 00:00:00",
					readAt: null,
				},
			]),
		);

		const code = await history({ limit: "20" }, out, err);

		expect(code).toBe(0);
		expect(stdout).toEqual([
			"→ [2026-01-01 00:00:00] question\n",
			"← [2026-01-01 00:01:00] answer\n",
		]);
		expect(stderr).toEqual([]);
	});

	test("returns 1 on http error", async () => {
		setMockFetch(async () => errorResponse(500, "internal error"));

		const code = await history({ limit: "20" }, out, err);

		expect(code).toBe(1);
		expect(stderr.some((s) => s.includes("500"))).toBe(true);
	});
});
