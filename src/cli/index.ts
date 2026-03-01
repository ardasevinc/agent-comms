#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../../package.json";
import { check } from "./commands/check.ts";
import { configInit } from "./commands/config-init.ts";
import { history } from "./commands/history.ts";
import { send } from "./commands/send.ts";
import { watch } from "./commands/watch.ts";

const program = new Command();

program
	.name("agent-comms")
	.description(
		"Bidirectional messaging between AI agents and humans via Telegram",
	)
	.version(pkg.version);

program
	.command("send")
	.description("Send a message to the human")
	.argument("<message>", "Message content")
	.action(send);

program.command("check").description("Check for new replies").action(check);

program
	.command("history")
	.description("View conversation history for this session")
	.option("-l, --limit <n>", "Number of messages to show", "20")
	.action(async (opts) => {
		process.exit(await history(opts));
	});

program
	.command("watch")
	.description("Block until a reply arrives, then exit")
	.option("--interval <seconds>", "Poll interval in seconds", "15")
	.option("--timeout <seconds>", "Give up after N seconds (exits 1)")
	.option("--continuous", "Keep printing replies without exiting")
	.action(async (opts) => {
		if (Number(opts.interval) < 1) {
			console.error("--interval must be at least 1 second");
			process.exit(1);
		}
		process.exit(await watch(opts));
	});

const config = program
	.command("config")
	.description("Manage CLI configuration");

config
	.command("init")
	.description("Create config file at ~/.config/agent-comms/config.json")
	.action(configInit);

program.parse();
