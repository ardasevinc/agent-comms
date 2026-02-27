import { Hono } from "hono";
import type { AgentIdentity, SendRequest } from "../shared/types.ts";
import { sendToTelegram } from "./bot.ts";
import {
	getAndMarkUnreadReplies,
	getHistory,
	getUnreadReplies,
	insertMessage,
} from "./db.ts";

const API_KEY = process.env.API_KEY;
if (!API_KEY) throw new Error("API_KEY is required");

export const app = new Hono();

// Auth middleware (skip health check)
app.use("*", async (c, next) => {
	if (c.req.path === "/health") return next();

	const auth = c.req.header("Authorization");
	if (auth !== `Bearer ${API_KEY}`) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return next();
});

app.get("/health", (c) => c.json({ ok: true }));

app.post("/messages", async (c) => {
	let body: SendRequest;
	try {
		body = await c.req.json<SendRequest>();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	if (!isValidSendRequest(body)) {
		return c.json({ error: "identity and content are required" }, 400);
	}

	const { identity, content } = body;
	const id = insertMessage(identity, "agent_to_human", content);
	const telegramMessageId = await sendToTelegram(id, identity, content);

	return c.json({ id, telegramMessageId }, 201);
});

app.get("/messages/:sessionId", (c) => {
	const sessionId = c.req.param("sessionId");
	const markRead = c.req.query("mark_read") !== "false";

	const messages = markRead
		? getAndMarkUnreadReplies(sessionId)
		: getUnreadReplies(sessionId);

	return c.json({ messages });
});

app.get("/messages/:sessionId/history", (c) => {
	const sessionId = c.req.param("sessionId");
	const limitRaw = c.req.query("limit");
	const limit = limitRaw === undefined ? 20 : Number(limitRaw);
	if (!Number.isInteger(limit) || limit < 0) {
		return c.json({ error: "limit must be a non-negative integer" }, 400);
	}

	const messages = getHistory(sessionId, limit);
	return c.json({ messages });
});

function isValidSendRequest(body: unknown): body is SendRequest {
	if (typeof body !== "object" || body === null) return false;

	const b = body as Partial<SendRequest>;
	if (typeof b.content !== "string" || b.content.length === 0) return false;
	if (!isValidIdentity(b.identity)) return false;

	return true;
}

function isValidIdentity(identity: unknown): identity is AgentIdentity {
	if (typeof identity !== "object" || identity === null) return false;

	const id = identity as Partial<AgentIdentity>;
	return (
		isValidAgentType(id.agentType) &&
		isNonEmptyString(id.sessionId) &&
		isNonEmptyString(id.hostname) &&
		isNonEmptyString(id.project)
	);
}

function isValidAgentType(type: unknown): type is AgentIdentity["agentType"] {
	return type === "claude" || type === "codex" || type === "unknown";
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}
