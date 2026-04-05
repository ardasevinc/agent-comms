import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

interface ChannelState {
	sessions: Record<string, number>;
}

const DEFAULT_STATE: ChannelState = { sessions: {} };

export function getChannelStatePath(): string {
	return (
		process.env.AGENT_COMMS_CHANNEL_STATE_PATH ??
		join(process.env.HOME ?? "", ".config", "agent-comms", "channel-state.json")
	);
}

export function readCursorState(path = getChannelStatePath()): ChannelState {
	if (!existsSync(path)) return DEFAULT_STATE;

	try {
		const stat = statSync(path);
		if (stat.mode & 0o077) {
			console.error(
				`Warning: ${path} is accessible by other users. Run: chmod 600 ${path}`,
			);
		}
		const parsed = JSON.parse(
			readFileSync(path, "utf-8"),
		) as Partial<ChannelState>;
		return {
			sessions: parsed.sessions ?? {},
		};
	} catch {
		return DEFAULT_STATE;
	}
}

export function readLastEventId(
	sessionId: string,
	path = getChannelStatePath(),
): number | null {
	const state = readCursorState(path);
	return state.sessions[sessionId] ?? null;
}

export function writeLastEventId(
	sessionId: string,
	lastEventId: number,
	path = getChannelStatePath(),
): void {
	const state = readCursorState(path);
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	state.sessions[sessionId] = lastEventId;
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, "\t"), { mode: 0o600 });
	renameSync(tmp, path);
}
