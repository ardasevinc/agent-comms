import { describe, expect, test } from "bun:test";
import {
	type BunTimeoutServer,
	createFetchHandler,
	isSessionStreamPath,
} from "../server.ts";

describe("service server wrapper", () => {
	test("matches only session stream paths", () => {
		expect(isSessionStreamPath("/messages/abc/stream")).toBe(true);
		expect(isSessionStreamPath("/messages/abc/history")).toBe(false);
		expect(isSessionStreamPath("/health")).toBe(false);
		expect(isSessionStreamPath("/messages//stream")).toBe(false);
		expect(isSessionStreamPath("/messages/abc/stream/extra")).toBe(false);
	});

	test("disables Bun idle timeout for SSE stream requests only", async () => {
		const calls: Array<{ request: Request; seconds: number }> = [];
		const server: BunTimeoutServer = {
			timeout(request, seconds) {
				calls.push({ request, seconds });
			},
		};

		const fetchHandler = createFetchHandler(() => new Response("ok"));
		const streamRequest = new Request("http://localhost/messages/qa/stream");
		const healthRequest = new Request("http://localhost/health");

		await fetchHandler(streamRequest, server);
		await fetchHandler(healthRequest, server);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({ request: streamRequest, seconds: 0 });
	});
});
