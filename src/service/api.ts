import { Hono } from "hono";
import type { SendRequest } from "../shared/types.ts";
import { sendToTelegram } from "./bot.ts";
import {
	getHistory,
	getUnreadReplies,
	insertMessage,
	markRepliesRead,
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
	const body = await c.req.json<SendRequest>();

	if (!body.identity || !body.content) {
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

	const messages = getUnreadReplies(sessionId);

	if (markRead && messages.length > 0) {
		markRepliesRead(sessionId);
	}

	return c.json({ messages });
});

app.get("/messages/:sessionId/history", (c) => {
	const sessionId = c.req.param("sessionId");
	const limit = Number(c.req.query("limit") ?? 20);

	const messages = getHistory(sessionId, limit);
	return c.json({ messages });
});
