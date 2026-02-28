import type { CheckResponse } from "../../shared/types.ts";
import { getConfig } from "../config.ts";
import { detectIdentity } from "../identity.ts";

export interface WatchOptions {
	interval: string;
	timeout?: string;
	continuous?: boolean;
}

export async function watch(
	opts: WatchOptions,
	out: (s: string) => void = (s) => process.stdout.write(s),
	err: (s: string) => void = (s) => process.stderr.write(s),
): Promise<0 | 1> {
	const config = getConfig();
	const identity = detectIdentity();
	const intervalMs = Number(opts.interval) * 1000;
	const timeoutMs = opts.timeout ? Number(opts.timeout) * 1000 : null;
	const startedAt = Date.now();

	err(`Waiting for reply... (checking every ${opts.interval}s)\n`);

	while (true) {
		const res = await fetch(
			`${config.serverUrl}/messages/${identity.sessionId}?mark_read=true`,
			{ headers: { Authorization: `Bearer ${config.apiKey}` } },
		);

		if (!res.ok) {
			const body = await res.text();
			err(`Failed to check (${res.status}): ${body}\n`);
			return 1;
		}

		const data = (await res.json()) as CheckResponse;

		if (data.messages.length > 0) {
			for (const msg of data.messages) {
				out(`${msg.content}\n`);
			}
			if (!opts.continuous) return 0;
		}

		const elapsed = Date.now() - startedAt;
		if (timeoutMs !== null && elapsed >= timeoutMs) {
			err("Timed out waiting for reply.\n");
			return 1;
		}

		await Bun.sleep(intervalMs);
	}
}
