import { app } from "./api.ts";
import { bot, registerCommands } from "./bot.ts";

const PORT = Number(process.env.PORT ?? 3000);

// Start Telegram bot (long polling)
bot.start({
	onStart: async () => {
		await registerCommands();
		console.log("Telegram bot started");
	},
});

// Start HTTP server
export default {
	port: PORT,
	fetch: app.fetch,
};

console.log(`API server listening on :${PORT}`);
