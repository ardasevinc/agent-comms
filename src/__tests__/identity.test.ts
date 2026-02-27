import { afterEach, describe, expect, test } from "bun:test";
import { hostname } from "node:os";
import { basename } from "node:path";

describe("detectIdentity", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		// Restore env
		for (const key of Object.keys(process.env)) {
			if (!(key in originalEnv)) {
				delete process.env[key];
			}
		}
		Object.assign(process.env, originalEnv);
	});

	test("detects claude agent type from CLAUDECODE env", async () => {
		process.env.CLAUDECODE = "1";
		delete process.env.CODEX_THREAD_ID;

		// Fresh import to pick up env changes
		const { detectIdentity } = await import("../cli/identity.ts");
		const id = detectIdentity();

		expect(id.agentType).toBe("claude");
		expect(id.hostname).toBe(hostname());
		expect(id.project).toBe(basename(process.cwd()));
	});

	test("detects codex agent type from CODEX_THREAD_ID env", async () => {
		delete process.env.CLAUDECODE;
		process.env.CODEX_THREAD_ID = "019c9142-1b03-7603-a27f-4c16ed568a58";

		const { detectIdentity } = await import("../cli/identity.ts");
		const id = detectIdentity();

		expect(id.agentType).toBe("codex");
		expect(id.sessionId).toBe("019c9142-1b03-7603-a27f-4c16ed568a58");
	});

	test("uses CLAUDE_SESSION_ID when available", async () => {
		process.env.CLAUDECODE = "1";
		process.env.CLAUDE_SESSION_ID = "explicit-session-id";
		delete process.env.CODEX_THREAD_ID;

		const { detectIdentity } = await import("../cli/identity.ts");
		const id = detectIdentity();

		expect(id.sessionId).toBe("explicit-session-id");
	});

	test("returns unknown agent type when no env vars set", async () => {
		delete process.env.CLAUDECODE;
		delete process.env.CODEX_THREAD_ID;

		const { detectIdentity } = await import("../cli/identity.ts");
		const id = detectIdentity();

		expect(id.agentType).toBe("unknown");
	});
});
