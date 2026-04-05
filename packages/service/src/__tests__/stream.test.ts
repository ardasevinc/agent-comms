import { afterEach, describe, expect, test } from "bun:test";

process.env.API_KEY = "test-key";
process.env.TELEGRAM_BOT_TOKEN = "fake:token";
process.env.TELEGRAM_CHAT_ID = "12345";
process.env.DATABASE_PATH = `/tmp/agent-comms-stream-test-${Date.now()}.db`;

const { app } = await import("../api.ts");
const {
	clearMessages,
	getAndMarkUnreadReplies,
	getMessageById,
	getRepliesAfterId,
	getUnreadReplies,
	insertMessage,
} = await import("../db.ts");
const { clearSessionStreams, pushToSession } = await import("../stream.ts");

const BASE = "http://localhost";

const identity = {
	agentType: "claude" as const,
	sessionId: "stream-test-session",
	hostname: "test-host",
	project: "test-proj",
};

afterEach(() => {
	clearSessionStreams();
	clearMessages();
});

describe("GET /messages/:sessionId/stream", () => {
	test("rejects invalid Last-Event-ID header", async () => {
		const res = await app.fetch(
			new Request(`${BASE}/messages/${identity.sessionId}/stream`, {
				headers: {
					Authorization: "Bearer test-key",
					"Last-Event-ID": "nope",
				},
			}),
		);

		expect(res.status).toBe(400);
	});

	test("flushes unread replies and marks them read", async () => {
		const firstId = insertMessage(identity, "human_to_agent", "first unread");

		const { reader, abort } = await openStream();
		const rawEvent = await readNextEvent(reader);
		abort.abort();

		expect(rawEvent).toContain("event: message");
		expect(rawEvent).toContain(`id: ${firstId}`);

		const payload = extractJsonPayload(rawEvent) as { content: string };
		expect(payload.content).toBe("first unread");
		expect(getUnreadReplies(identity.sessionId)).toHaveLength(0);
	});

	test("replays messages after Last-Event-ID even if already marked read", async () => {
		const firstId = insertMessage(identity, "human_to_agent", "old");
		insertMessage(identity, "human_to_agent", "replay me");
		insertMessage(identity, "human_to_agent", "and me");
		getAndMarkUnreadReplies(identity.sessionId);

		const { reader, abort } = await openStream({
			"Last-Event-ID": String(firstId),
		});
		const eventA = await readNextEvent(reader);
		const eventB = await readNextEvent(reader);
		abort.abort();

		expect(extractJsonPayload(eventA)).toMatchObject({ content: "replay me" });
		expect(extractJsonPayload(eventB)).toMatchObject({ content: "and me" });
		expect(getRepliesAfterId(identity.sessionId, firstId)).toHaveLength(2);
	});

	test("pushes live replies through the stream", async () => {
		const { reader, abort } = await openStream();
		const id = insertMessage(identity, "human_to_agent", "live reply");
		const message = getMessageById(id);
		expect(message).not.toBeNull();

		await Bun.sleep(10);
		await pushToSession(identity.sessionId, message!);

		const rawEvent = await readNextEvent(reader);
		abort.abort();

		expect(extractJsonPayload(rawEvent)).toMatchObject({
			content: "live reply",
		});
		expect(getUnreadReplies(identity.sessionId)).toHaveLength(0);
	});
});

async function openStream(headers?: Record<string, string>) {
	const abort = new AbortController();
	const res = await app.fetch(
		new Request(`${BASE}/messages/${identity.sessionId}/stream`, {
			headers: {
				Authorization: "Bearer test-key",
				...(headers ?? {}),
			},
			signal: abort.signal,
		}),
	);

	expect(res.status).toBe(200);
	expect(res.body).toBeDefined();

	return { reader: res.body!.getReader(), abort };
}

async function readNextEvent(reader: {
	read(): Promise<{ done: boolean; value?: Uint8Array }>;
}): Promise<string> {
	let buffer = "";

	while (true) {
		const result = await Promise.race([
			reader.read(),
			Bun.sleep(1_000).then(() => ({ timeout: true as const })),
		]);

		if ("timeout" in result) {
			throw new Error(
				`Timed out waiting for SSE event. Buffer so far: ${buffer}`,
			);
		}

		if (result.done) {
			throw new Error(`SSE stream ended unexpectedly. Buffer: ${buffer}`);
		}

		buffer += new TextDecoder().decode(result.value);
		const splitAt = buffer.indexOf("\n\n");
		if (splitAt >= 0) {
			return buffer.slice(0, splitAt);
		}
	}
}

function extractJsonPayload(rawEvent: string): unknown {
	const line = rawEvent
		.split("\n")
		.find((candidate) => candidate.startsWith("data: "));
	if (!line) {
		throw new Error(`No data line found in event: ${rawEvent}`);
	}
	return JSON.parse(line.slice("data: ".length));
}
