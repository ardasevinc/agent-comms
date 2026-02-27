import { getConfig } from "../config.ts";
import { detectIdentity } from "../identity.ts";

export async function send(message: string) {
	const config = getConfig();
	const identity = detectIdentity();

	const res = await fetch(`${config.serverUrl}/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify({ identity, content: message }),
	});

	if (!res.ok) {
		const body = await res.text();
		console.error(`Failed to send (${res.status}): ${body}`);
		process.exit(1);
	}

	const data = (await res.json()) as { id: number };
	console.log(`Sent (id: ${data.id})`);
}
