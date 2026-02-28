#!/usr/bin/env bun
import { Command } from "commander";
import { check } from "./commands/check.ts";
import { configInit } from "./commands/config-init.ts";
import { history } from "./commands/history.ts";
import { send } from "./commands/send.ts";

const program = new Command();

program
	.name("agent-comms")
	.description(
		"Bidirectional messaging between AI agents and humans via Telegram",
	)
	.version("0.1.0");

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
	.action(history);

const config = program
	.command("config")
	.description("Manage CLI configuration");

config
	.command("init")
	.description("Create config file at ~/.config/agent-comms/config.json")
	.action(configInit);

program.parse();
