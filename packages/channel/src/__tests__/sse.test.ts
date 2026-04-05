import { describe, expect, test } from "bun:test";
import { parseEventBlock, parseSseBuffer } from "../sse.ts";

describe("parseEventBlock", () => {
	test("parses message event fields", () => {
		const event = parseEventBlock(
			"event: message\nid: 42\ndata: hello\nretry: 1000",
		);
		expect(event).toEqual({
			event: "message",
			id: "42",
			data: "hello",
			retry: 1000,
		});
	});

	test("joins multi-line data", () => {
		const event = parseEventBlock("data: first\ndata: second");
		expect(event).toEqual({
			data: "first\nsecond",
		});
	});
});

describe("parseSseBuffer", () => {
	test("returns complete events and trailing remainder", () => {
		const parsed = parseSseBuffer(
			"event: message\ndata: one\n\n:event comment\n\ndata: partial",
		);

		expect(parsed.events).toEqual([{ event: "message", data: "one" }]);
		expect(parsed.rest).toBe("data: partial");
	});
});
