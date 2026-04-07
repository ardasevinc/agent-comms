import { app } from "./api.ts";
import { bot, registerCommands } from "./bot.ts";

const PORT = Number(process.env.PORT ?? 3000);
const DISABLE_TELEGRAM_BOT = /^(1|true|yes|on)$/i.test(
	process.env.DISABLE_TELEGRAM_BOT ?? "",
);

if (DISABLE_TELEGRAM_BOT) {
	console.log("Telegram bot disabled via DISABLE_TELEGRAM_BOT");
} else {
	// Start Telegram bot (long polling)
	bot.start({
		onStart: async () => {
			await registerCommands();
			console.log("Telegram bot started");
		},
	});
}

// Start HTTP server
export default {
	port: PORT,
	fetch: app.fetch,
};

console.log(`API server listening on :${PORT}`);
