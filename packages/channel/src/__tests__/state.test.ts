import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readCursorState,
	readLastEventId,
	writeLastEventId,
} from "../state.ts";

describe("channel state", () => {
	let statePath: string | null = null;

	afterEach(() => {
		statePath = null;
	});

	test("writes and reads last event ids", () => {
		statePath = join(
			mkdtempSync(join(tmpdir(), "agent-comms-channel-state-")),
			"channel-state.json",
		);

		writeLastEventId("session-a", 41, statePath);
		writeLastEventId("session-b", 99, statePath);

		expect(readLastEventId("session-a", statePath)).toBe(41);
		expect(readLastEventId("session-b", statePath)).toBe(99);
		expect(readCursorState(statePath)).toEqual({
			sessions: {
				"session-a": 41,
				"session-b": 99,
			},
		});
	});

	test("creates state file with 0600 permissions", () => {
		statePath = join(
			mkdtempSync(join(tmpdir(), "agent-comms-channel-state-")),
			"channel-state.json",
		);

		writeLastEventId("session-a", 7, statePath);

		expect(existsSync(statePath)).toBe(true);
		expect(statSync(statePath).mode & 0o777).toBe(0o600);
	});
});
