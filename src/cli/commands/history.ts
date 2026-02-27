import type { HistoryResponse } from "../../shared/types.ts";
import { getConfig } from "../config.ts";
import { detectIdentity } from "../identity.ts";

export async function history(options: { limit: string }) {
	const config = getConfig();
	const identity = detectIdentity();
	const limit = Number(options.limit) || 20;

	const res = await fetch(
		`${config.serverUrl}/messages/${identity.sessionId}/history?limit=${limit}`,
		{
			headers: { Authorization: `Bearer ${config.apiKey}` },
		},
	);

	if (!res.ok) {
		const body = await res.text();
		console.error(`Failed to get history (${res.status}): ${body}`);
		process.exit(1);
	}

	const data = (await res.json()) as HistoryResponse;

	if (data.messages.length === 0) {
		console.log("No messages in this session.");
		return;
	}

	// Reverse so oldest is first (they come DESC from API)
	for (const msg of data.messages.reverse()) {
		const dir = msg.direction === "agent_to_human" ? "→" : "←";
		console.log(`${dir} [${msg.createdAt}] ${msg.content}`);
	}
}
