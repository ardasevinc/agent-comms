import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface LiveConfig {
	serverUrl: string;
	apiKey: string;
}

const RUN_LIVE = process.env.AGENT_COMMS_LIVE_TESTS === "1";
const liveConfig = resolveLiveConfig();

if (RUN_LIVE && !liveConfig) {
	throw new Error(
		"AGENT_COMMS_LIVE_TESTS=1 requires AGENT_COMMS_LIVE_URL and AGENT_COMMS_LIVE_API_KEY, or ~/.config/agent-comms/config.json",
	);
}

const liveTest = RUN_LIVE ? test : test.skip;

describe("live integration (optional)", () => {
	liveTest("GET /health is reachable without auth", async () => {
		const res = await fetch(`${liveConfig!.serverUrl}/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok?: boolean };
		expect(body.ok).toBe(true);
	});

	liveTest("GET /messages/:sessionId requires auth", async () => {
		const sessionId = randomSessionId();
		const res = await fetch(`${liveConfig!.serverUrl}/messages/${sessionId}`);
		expect(res.status).toBe(401);
	});

	liveTest(
		"GET /messages/:sessionId works with auth for fresh session",
		async () => {
			const sessionId = randomSessionId();
			const res = await fetch(
				`${liveConfig!.serverUrl}/messages/${sessionId}?mark_read=false`,
				{
					headers: { Authorization: `Bearer ${liveConfig!.apiKey}` },
				},
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { messages?: unknown[] };
			expect(Array.isArray(body.messages)).toBe(true);
			expect(body.messages).toHaveLength(0);
		},
	);

	liveTest(
		"GET /messages/:sessionId/history works with auth for fresh session",
		async () => {
			const sessionId = randomSessionId();
			const res = await fetch(
				`${liveConfig!.serverUrl}/messages/${sessionId}/history?limit=5`,
				{
					headers: { Authorization: `Bearer ${liveConfig!.apiKey}` },
				},
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { messages?: unknown[] };
			expect(Array.isArray(body.messages)).toBe(true);
			expect(body.messages).toHaveLength(0);
		},
	);
});

function resolveLiveConfig(): LiveConfig | null {
	// Prefer dedicated live-test env vars so Bun-loaded .env local dev values
	// (often localhost) don't accidentally override deployed config.
	const envUrl = process.env.AGENT_COMMS_LIVE_URL?.trim();
	const envKey = process.env.AGENT_COMMS_LIVE_API_KEY?.trim();
	if (envUrl && envKey) {
		return { serverUrl: stripTrailingSlash(envUrl), apiKey: envKey };
	}

	const fromGlobalConfig = readGlobalConfig();
	if (fromGlobalConfig) return fromGlobalConfig;

	const fallbackUrl = process.env.AGENT_COMMS_URL?.trim();
	const fallbackKey = process.env.AGENT_COMMS_API_KEY?.trim();
	if (fallbackUrl && fallbackKey) {
		return { serverUrl: stripTrailingSlash(fallbackUrl), apiKey: fallbackKey };
	}

	return null;
}

function readGlobalConfig(): LiveConfig | null {
	const home = process.env.HOME;
	if (!home) return null;

	const configPath = join(home, ".config", "agent-comms", "config.json");
	if (!existsSync(configPath)) return null;

	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<{
			serverUrl: string;
			apiKey: string;
		}>;
		const serverUrl = parsed.serverUrl?.trim();
		const apiKey = parsed.apiKey?.trim();
		if (!serverUrl || !apiKey) return null;
		return { serverUrl: stripTrailingSlash(serverUrl), apiKey };
	} catch {
		return null;
	}
}

function stripTrailingSlash(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}

function randomSessionId(): string {
	return `live-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
