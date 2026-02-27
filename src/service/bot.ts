import { Bot } from "grammy";
import type { AgentIdentity } from "../shared/types.ts";
import {
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

// Handle replies from Arda
bot.on("message:text", async (ctx) => {
	// Only respond to the configured chat
	if (ctx.chat.id !== chatId) return;

	const replyTo = ctx.message.reply_to_message;
	if (!replyTo) {
		await ctx.reply("Reply to a specific agent message to respond.");
		return;
	}

	const originalMessage = getMessageByTelegramId(replyTo.message_id);
	if (!originalMessage) {
		await ctx.reply("Couldn't find the original agent message.");
		return;
	}

	insertReply(originalMessage, ctx.message.text);

	const label = `[${originalMessage.agentType}] ${originalMessage.hostname} / ${originalMessage.project}`;
	await ctx.reply(`Sent to ${label}`, {
		reply_to_message_id: ctx.message.message_id,
	});
});

export async function sendToTelegram(
	messageId: number,
	identity: AgentIdentity,
	content: string,
): Promise<number | null> {
	const header = `<b>[${identity.agentType}]</b> ${escapeHtml(identity.hostname)} / ${escapeHtml(identity.project)}`;
	const text = `${header}\n\n${escapeHtml(content)}`;

	try {
		const sent = await bot.api.sendMessage(chatId, text, {
			parse_mode: "HTML",
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
