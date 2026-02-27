import { randomUUID } from "node:crypto";
import { readlinkSync } from "node:fs";
import { hostname } from "node:os";
import { basename } from "node:path";
import type { AgentIdentity } from "../shared/types.ts";

function detectAgentType(): AgentIdentity["agentType"] {
	if (process.env.CLAUDECODE === "1") return "claude";
	if (process.env.CODEX_THREAD_ID) return "codex";
	return "unknown";
}

function detectSessionId(): string {
	// Explicit env vars first
	if (process.env.CLAUDE_SESSION_ID) return process.env.CLAUDE_SESSION_ID;
	if (process.env.CODEX_THREAD_ID) return process.env.CODEX_THREAD_ID;

	// Claude Code debug symlink fallback
	try {
		const home = process.env.HOME ?? "";
		const target = readlinkSync(`${home}/.claude/debug/latest`);
		const id = basename(target, ".txt");
		if (id?.includes("-")) return id;
	} catch {
		// not in claude code or symlink doesn't exist
	}

	return randomUUID();
}

export function detectIdentity(): AgentIdentity {
	return {
		agentType: detectAgentType(),
		sessionId: detectSessionId(),
		hostname: hostname(),
		project: basename(process.cwd()),
	};
}
