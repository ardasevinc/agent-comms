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
	const intervalSeconds = parseNonNegativeNumber(opts.interval);
	if (intervalSeconds === null) {
		err("Invalid --interval. Provide a non-negative number of seconds.\n");
		return 1;
	}
	const intervalMs = intervalSeconds * 1000;

	const timeoutSeconds =
		opts.timeout === undefined ? null : parseNonNegativeNumber(opts.timeout);
	if (opts.timeout !== undefined && timeoutSeconds === null) {
		err("Invalid --timeout. Provide a non-negative number of seconds.\n");
		return 1;
	}
	let timeoutMs = timeoutSeconds === null ? null : timeoutSeconds * 1000;

	if (opts.continuous && timeoutMs !== null) {
		err("Warning: --continuous ignores --timeout\n");
		timeoutMs = null;
	}

	const startedAt = Date.now();

	err(`Waiting for reply... (checking every ${opts.interval}s)\n`);

	let consecutiveErrors = 0;

	while (true) {
		let res: Response;
		try {
			res = await fetch(
				`${config.serverUrl}/messages/${identity.sessionId}?mark_read=true`,
				{ headers: { Authorization: `Bearer ${config.apiKey}` } },
			);
		} catch (e) {
			if (!opts.continuous) {
				err(
					`Connection failed: ${e instanceof Error ? e.message : e}\n`,
				);
				return 1;
			}
			consecutiveErrors++;
			const delay = retryDelay(intervalMs, consecutiveErrors);
			err(`Connection error, retrying in ${fmtDelay(delay)}...\n`);
			await Bun.sleep(delay);
			continue;
		}

		if (!res.ok) {
			if (!opts.continuous) {
				const body = await res.text();
				err(`Failed to check (${res.status}): ${body}\n`);
				return 1;
			}
			consecutiveErrors++;
			const delay = retryDelay(intervalMs, consecutiveErrors);
			err(`Check failed (${res.status}), retrying in ${fmtDelay(delay)}...\n`);
			await Bun.sleep(delay);
			continue;
		}

		consecutiveErrors = 0;
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

function parseNonNegativeNumber(value: string): number | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return parsed;
}

function retryDelay(baseMs: number, attempt: number): number {
	const delay = Math.min(baseMs * 2 ** (attempt - 1), 60_000);
	return delay * (0.75 + Math.random() * 0.5);
}

function fmtDelay(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${Math.round(ms / 1000)}s`;
}
