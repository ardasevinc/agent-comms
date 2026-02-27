import { Bot, InlineKeyboard } from "grammy";
import type { AgentIdentity, Message } from "../shared/types.ts";
import {
	getActiveSessions,
	getLastAgentMessage,
	getLastAgentMessageBySession,
	getMessageByTelegramId,
	insertReply,
	setTelegramMessageId,
} from "./db.ts";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!CHAT_ID) throw new Error("TELEGRAM_CHAT_ID is required");

const chatId = Number(CHAT_ID);

export const bot = new Bot(TOKEN);

// Register commands with Telegram for autocomplete (called on bot.start)
export async function registerCommands() {
	await bot.api.setMyCommands([
		{ command: "reply", description: "Pick an agent session to reply to" },
	]);
}

// /reply command — show active sessions as inline keyboard buttons
bot.command("reply", async (ctx) => {
	if (ctx.chat.id !== chatId) return;

	const sessions = getActiveSessions();
	if (sessions.length === 0) {
		await ctx.reply("No active agent sessions.");
		return;
	}

	const keyboard = new InlineKeyboard();
	for (const s of sessions) {
		const label = `[${s.agentType}] ${s.hostname} / ${s.project}`;
		keyboard.text(label, `reply:${s.sessionId}`).row();
	}

	await ctx.reply("Reply to which agent?", { reply_markup: keyboard });
});

// Callback query from inline keyboard — reply button on agent msg or /reply picker
bot.on("callback_query:data", async (ctx) => {
	const callbackChatId = ctx.callbackQuery.message?.chat.id;
	if (callbackChatId !== chatId) {
		await ctx.answerCallbackQuery();
		return;
	}

	const data = ctx.callbackQuery.data;

	if (data.startsWith("reply:")) {
		const sessionId = data.slice("reply:".length);
		const msg = getLastAgentMessageBySession(sessionId);
		if (!msg) {
			await ctx.answerCallbackQuery({
				text: "Reply target is no longer active. Use /reply again.",
				show_alert: true,
			});
			return;
		}

		pendingReplies.set(ctx.from.id, sessionId);

		const label = msg
			? `[${msg.agentType}] ${msg.hostname} / ${msg.project}`
			: sessionId;

		await ctx.answerCallbackQuery({
			text: `Next message → ${label}`,
		});
		return;
	}

	await ctx.answerCallbackQuery();
});

// Track pending replies from inline keyboard interactions
const pendingReplies = new Map<number, string>();

// Handle text messages from the human
bot.on("message:text", async (ctx) => {
	if (ctx.chat.id !== chatId) return;

	const replyTo = ctx.message.reply_to_message;
	const target = resolveReplyTarget({
		replyToMessageId: replyTo?.message_id,
		fromUserId: ctx.from.id,
	});

	if (target.kind === "error") {
		await ctx.reply(target.message);
		return;
	}

	insertReply(target.message, ctx.message.text);
	await ctx.react("👍");
});

export async function sendToTelegram(
	messageId: number,
	identity: AgentIdentity,
	content: string,
): Promise<number | null> {
	const header = `<b>[${identity.agentType}]</b> ${escapeHtml(identity.hostname)} / ${escapeHtml(identity.project)}`;
	const text = `${header}\n\n${escapeHtml(content)}`;

	const keyboard = new InlineKeyboard().text(
		"Reply",
		`reply:${identity.sessionId}`,
	);

	try {
		const sent = await bot.api.sendMessage(chatId, text, {
			parse_mode: "HTML",
			reply_markup: keyboard,
		});
		setTelegramMessageId(messageId, sent.message_id);
		return sent.message_id;
	} catch (err) {
		console.error("Failed to send to Telegram:", err);
		return null;
	}
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type ReplyTargetResult =
	| { kind: "deliver"; message: Message }
	| { kind: "error"; message: string };

interface ReplyTargetInput {
	replyToMessageId?: number;
	fromUserId: number;
}

export function resolveReplyTarget(input: ReplyTargetInput): ReplyTargetResult {
	// 1. Swipe-reply to a specific message (strict mapping required)
	if (input.replyToMessageId !== undefined) {
		const originalMessage = getMessageByTelegramId(input.replyToMessageId);
		if (!originalMessage) {
			return {
				kind: "error",
				message:
					"Couldn't find the original agent message. Use /reply to select an active agent.",
			};
		}
		return { kind: "deliver", message: originalMessage };
	}

	// 2. Pending reply target from inline button tap
	const pendingSessionId = pendingReplies.get(input.fromUserId);
	if (pendingSessionId) {
		pendingReplies.delete(input.fromUserId);
		const sessionMsg = getLastAgentMessageBySession(pendingSessionId);
		if (!sessionMsg) {
			return {
				kind: "error",
				message:
					"Reply target is no longer active. Use /reply and choose again.",
			};
		}
		return { kind: "deliver", message: sessionMsg };
	}

	// 3. Plain text fallback — route to most recent agent
	const lastAgent = getLastAgentMessage();
	if (!lastAgent) {
		return { kind: "error", message: "No agents have messaged yet." };
	}
	return { kind: "deliver", message: lastAgent };
}

export function __testOnly_setPendingReply(userId: number, sessionId: string) {
	pendingReplies.set(userId, sessionId);
}

export function __testOnly_clearPendingReplies() {
	pendingReplies.clear();
}
