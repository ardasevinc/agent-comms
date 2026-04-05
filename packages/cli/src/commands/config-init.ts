import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CONFIG_PATH = `${process.env.HOME}/.config/agent-comms/config.json`;

export function configInit() {
	if (existsSync(CONFIG_PATH)) {
		console.error(`Config already exists at ${CONFIG_PATH}`);
		console.error("Delete it first if you want to reinitialize.");
		process.exit(1);
	}

	const dir = dirname(CONFIG_PATH);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	const config = { serverUrl: "", apiKey: "" };
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, "\t"), {
		mode: 0o600,
	});
	console.log(`Config created at ${CONFIG_PATH}`);
}
