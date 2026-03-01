import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.AGENT_COMMS_URL = "http://test-service";
process.env.AGENT_COMMS_API_KEY = "test-key";
// no CLAUDE_SESSION_ID — identity fallback generates a UUID, fine since fetch is mocked

const { watch } = await import("../cli/commands/watch.ts");

function makeCheckResponse(contents: string[]) {
	const messages = contents.map((content, i) => ({
		id: i + 1,
		sessionId: "watch-test-session",
		agentType: "claude",
		hostname: "test-host",
		project: "test-proj",
		direction: "human_to_agent",
		content,
		telegramMessageId: null,
		createdAt: "2026-01-01 00:00:00",
		readAt: null,
	}));
	return new Response(JSON.stringify({ messages }), { status: 200 });
}

function emptyCheckResponse() {
	return new Response(JSON.stringify({ messages: [] }), { status: 200 });
}

function errorResponse(status: number, body: string) {
	return new Response(body, { status });
}

/** Returns a promise that never resolves — used to pause the watch loop in continuous tests. */
function hangForever(): Promise<Response> {
	return new Promise(() => {});
}

function setMockFetch(handler: () => Promise<Response>) {
	globalThis.fetch = handler as unknown as typeof fetch;
}

describe("watch", () => {
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

	test("exits 0 immediately when replies exist on first check", async () => {
		setMockFetch(async () => makeCheckResponse(["Use SQLite"]));

		const code = await watch({ interval: "0" }, out, err);

		expect(code).toBe(0);
		expect(stdout).toEqual(["Use SQLite\n"]);
	});

	test("polls again when first check returns no replies", async () => {
		let calls = 0;
		setMockFetch(async () => {
			calls++;
			if (calls === 1) return emptyCheckResponse();
			return makeCheckResponse(["Keep it simple"]);
		});

		const code = await watch({ interval: "0" }, out, err);

		expect(code).toBe(0);
		expect(calls).toBe(2);
		expect(stdout).toEqual(["Keep it simple\n"]);
	});

	test("prints all messages in a single reply batch", async () => {
		setMockFetch(async () =>
			makeCheckResponse(["First reply", "Second reply"]),
		);

		const code = await watch({ interval: "0" }, out, err);

		expect(code).toBe(0);
		expect(stdout).toEqual(["First reply\n", "Second reply\n"]);
	});

	test("times out and returns 1 when no replies arrive", async () => {
		setMockFetch(async () => emptyCheckResponse());

		const code = await watch({ interval: "0", timeout: "0" }, out, err);

		expect(code).toBe(1);
		expect(stderr.some((s) => s.includes("Timed out"))).toBe(true);
	});

	test("returns 1 on http error (one-shot)", async () => {
		setMockFetch(async () => errorResponse(500, "internal error"));

		const code = await watch({ interval: "0" }, out, err);

		expect(code).toBe(1);
		expect(stderr.some((s) => s.includes("500"))).toBe(true);
	});

	test("returns 1 on connection error (one-shot)", async () => {
		setMockFetch(async () => {
			throw new Error("ECONNREFUSED");
		});

		const code = await watch({ interval: "0" }, out, err);

		expect(code).toBe(1);
		expect(stderr.some((s) => s.includes("ECONNREFUSED"))).toBe(true);
	});

	test("continuous mode: keeps polling after first reply", async () => {
		let calls = 0;
		setMockFetch(async () => {
			calls++;
			if (calls === 1) return makeCheckResponse(["reply 1"]);
			if (calls === 2) return makeCheckResponse(["reply 2"]);
			// pause loop after collecting enough data
			return hangForever();
		});

		// don't await — continuous mode never exits on its own
		watch({ interval: "0", continuous: true }, out, err);
		await Bun.sleep(50);

		expect(stdout).toEqual(["reply 1\n", "reply 2\n"]);
		expect(calls).toBe(3);
	});

	test("continuous mode: ignores --timeout", async () => {
		let calls = 0;
		setMockFetch(async () => {
			calls++;
			// timeout:"0" would fire immediately in one-shot mode
			if (calls === 1) return emptyCheckResponse();
			if (calls === 2) return makeCheckResponse(["late reply"]);
			return hangForever();
		});

		watch(
			{ interval: "0", timeout: "0", continuous: true },
			out,
			err,
		);
		await Bun.sleep(50);

		expect(stdout).toEqual(["late reply\n"]);
		expect(stderr.some((s) => s.includes("ignores --timeout"))).toBe(true);
	});

	test("continuous mode: retries on transient errors then recovers", async () => {
		let calls = 0;
		setMockFetch(async () => {
			calls++;
			if (calls === 1) throw new Error("ECONNREFUSED");
			if (calls === 2) return errorResponse(503, "unavailable");
			if (calls === 3) return makeCheckResponse(["recovered"]);
			return hangForever();
		});

		watch({ interval: "0", continuous: true }, out, err);
		await Bun.sleep(50);

		expect(stdout).toEqual(["recovered\n"]);
		expect(calls).toBe(4);
		expect(stderr.some((s) => s.includes("Connection error"))).toBe(true);
		expect(stderr.some((s) => s.includes("503"))).toBe(true);
	});

	test("writes status to stderr, reply content to stdout only", async () => {
		setMockFetch(async () => makeCheckResponse(["answer"]));

		await watch({ interval: "0" }, out, err);

		expect(stdout).toEqual(["answer\n"]);
		expect(stderr.length).toBeGreaterThan(0);
		expect(stderr.every((s) => !s.includes("answer"))).toBe(true);
	});

	test("returns 1 for invalid interval and does not call fetch", async () => {
		let calls = 0;
		setMockFetch(async () => {
			calls++;
			return emptyCheckResponse();
		});

		const code = await watch({ interval: "abc" }, out, err);

		expect(code).toBe(1);
		expect(calls).toBe(0);
		expect(stderr.some((s) => s.includes("Invalid --interval"))).toBe(true);
	});

	test("returns 1 for negative interval and does not call fetch", async () => {
		let calls = 0;
		setMockFetch(async () => {
			calls++;
			return emptyCheckResponse();
		});

		const code = await watch({ interval: "-1" }, out, err);

		expect(code).toBe(1);
		expect(calls).toBe(0);
		expect(stderr.some((s) => s.includes("Invalid --interval"))).toBe(true);
	});

	test("returns 1 for invalid timeout and does not call fetch", async () => {
		let calls = 0;
		setMockFetch(async () => {
			calls++;
			return emptyCheckResponse();
		});

		const code = await watch({ interval: "0", timeout: "abc" }, out, err);

		expect(code).toBe(1);
		expect(calls).toBe(0);
		expect(stderr.some((s) => s.includes("Invalid --timeout"))).toBe(true);
	});

	test("returns 1 for negative timeout and does not call fetch", async () => {
		let calls = 0;
		setMockFetch(async () => {
			calls++;
			return emptyCheckResponse();
		});

		const code = await watch({ interval: "0", timeout: "-1" }, out, err);

		expect(code).toBe(1);
		expect(calls).toBe(0);
		expect(stderr.some((s) => s.includes("Invalid --timeout"))).toBe(true);
	});
});
