import { getConfig } from "@agent-comms/shared/config";
import { detectIdentity } from "@agent-comms/shared/identity";
import type { CheckResponse } from "@agent-comms/shared/types";

export async function check() {
	const config = getConfig();
	const identity = detectIdentity();

	const res = await fetch(
		`${config.serverUrl}/messages/${identity.sessionId}?mark_read=true`,
		{
			headers: { Authorization: `Bearer ${config.apiKey}` },
		},
	);

	if (!res.ok) {
		const body = await res.text();
		console.error(`Failed to check (${res.status}): ${body}`);
		process.exit(1);
	}

	const data = (await res.json()) as CheckResponse;

	if (data.messages.length === 0) {
		console.log("No new messages.");
		return;
	}

	for (const msg of data.messages) {
		console.log(`[${msg.createdAt}] ${msg.content}`);
	}
}
