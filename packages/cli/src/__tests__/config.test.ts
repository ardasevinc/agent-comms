import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("config init", () => {
	const origHome = process.env.HOME;

	afterEach(() => {
		process.env.HOME = origHome;
	});

	test("creates dir with 0700 and file with 0600 permissions", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "agent-comms-config-test-"));
		process.env.HOME = tempHome;

		// fresh import so CONFIG_PATH picks up the temp HOME
		const { configInit } = await import("../commands/config-init.ts");
		configInit();

		const configDir = join(tempHome, ".config", "agent-comms");
		const configFile = join(configDir, "config.json");

		const dirStat = statSync(configDir);
		const fileStat = statSync(configFile);

		// mask to permission bits only
		expect(dirStat.mode & 0o777).toBe(0o700);
		expect(fileStat.mode & 0o777).toBe(0o600);
	});
});
