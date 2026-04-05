import { getConfig } from "@agent-comms/shared/config";
import { detectIdentity } from "@agent-comms/shared/identity";
import type { HistoryResponse } from "@agent-comms/shared/types";

export interface HistoryOptions {
	limit: string;
}

export async function history(
	options: HistoryOptions,
	out: (s: string) => void = (s) => process.stdout.write(s),
	err: (s: string) => void = (s) => process.stderr.write(s),
): Promise<0 | 1> {
	const config = getConfig();
	const identity = detectIdentity();
	const limit = parseNonNegativeInteger(options.limit);
	if (limit === null) {
		err("Invalid --limit. Provide a non-negative integer.\n");
		return 1;
	}

	const res = await fetch(
		`${config.serverUrl}/messages/${identity.sessionId}/history?limit=${limit}`,
		{
			headers: { Authorization: `Bearer ${config.apiKey}` },
		},
	);

	if (!res.ok) {
		const body = await res.text();
		err(`Failed to get history (${res.status}): ${body}\n`);
		return 1;
	}

	const data = (await res.json()) as HistoryResponse;

	if (data.messages.length === 0) {
		out("No messages in this session.\n");
		return 0;
	}

	// Reverse so oldest is first (they come DESC from API)
	for (const msg of data.messages.reverse()) {
		const dir = msg.direction === "agent_to_human" ? "→" : "←";
		out(`${dir} [${msg.createdAt}] ${msg.content}\n`);
	}

	return 0;
}

function parseNonNegativeInteger(value: string): number | null {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) return null;
	return parsed;
}
