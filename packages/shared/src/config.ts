import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

interface Config {
	serverUrl: string;
	apiKey: string;
}

const CONFIG_PATH = join(
	process.env.HOME ?? "",
	".config",
	"agent-comms",
	"config.json",
);

function loadConfigFile(): Partial<Config> {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		const stat = statSync(CONFIG_PATH);
		if (stat.mode & 0o077) {
			console.error(
				`Warning: ${CONFIG_PATH} is accessible by other users. Run: chmod 600 ${CONFIG_PATH}`,
			);
		}
		return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
	} catch {
		return {};
	}
}

export function getConfig(): Config {
	const file = loadConfigFile();

	const serverUrl = process.env.AGENT_COMMS_URL ?? file.serverUrl;
	const apiKey = process.env.AGENT_COMMS_API_KEY ?? file.apiKey;

	if (!serverUrl) {
		console.error(
			"No server URL. Set AGENT_COMMS_URL or configure ~/.config/agent-comms/config.json",
		);
		process.exit(1);
	}
	if (!apiKey) {
		console.error(
			"No API key. Set AGENT_COMMS_API_KEY or configure ~/.config/agent-comms/config.json",
		);
		process.exit(1);
	}

	return { serverUrl, apiKey };
}
