import { getConfig } from "@agent-comms/shared/config";
import { detectIdentity } from "@agent-comms/shared/identity";
import type { Message, SendResponse } from "@agent-comms/shared/types";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { consumeSseStream, type SseEvent } from "./sse.ts";
import { readLastEventId, writeLastEventId } from "./state.ts";

const ReplyArgsSchema = z.object({
	text: z.string().trim().min(1),
});

export async function serveChannel(): Promise<void> {
	const config = getConfig();
	const identity = detectIdentity();
	const transport = new StdioServerTransport();
	const server = new Server(
		{ name: "agent-comms", version: "0.2.1" },
		{
			capabilities: {
				experimental: {
					"claude/channel": {},
				},
				tools: {},
			},
			instructions: [
				'Messages from the human arrive as <channel source="agent-comms" ...> blocks.',
				"Transcript output in this terminal does not reach the human operator.",
				"Use the reply tool for any message that should go back to the human.",
			].join("\n"),
		},
	);

	registerReplyTool(server, config.serverUrl, config.apiKey, identity);

	let stopped = false;
	let activeAbort: AbortController | null = null;
	const stop = () => {
		stopped = true;
		activeAbort?.abort();
	};

	process.stdin.on("close", stop);
	process.stdin.on("end", stop);
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);

	await server.connect(transport);
	await runBridgeLoop({
		server,
		serverUrl: config.serverUrl,
		apiKey: config.apiKey,
		sessionId: identity.sessionId,
		stopped: () => stopped,
		setAbortController: (controller) => {
			activeAbort = controller;
		},
	});
}

function registerReplyTool(
	server: Server,
	serverUrl: string,
	apiKey: string,
	identity: ReturnType<typeof detectIdentity>,
): void {
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: "reply",
				description: "Send a message to the human operator via agent-comms.",
				inputSchema: {
					type: "object",
					properties: {
						text: {
							type: "string",
							description:
								"Message content to send back to the human operator.",
						},
					},
					required: ["text"],
				},
			},
		],
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		if (request.params.name !== "reply") {
			return toolError(`Unknown tool: ${request.params.name}`);
		}

		const parsed = ReplyArgsSchema.safeParse(request.params.arguments ?? {});
		if (!parsed.success) {
			return toolError(
				parsed.error.issues.at(0)?.message ?? "Invalid arguments",
			);
		}

		const res = await fetch(`${serverUrl}/messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({ identity, content: parsed.data.text }),
		});

		if (!res.ok) {
			const body = await res.text();
			return toolError(`Failed to send (${res.status}): ${body}`);
		}

		const data = (await res.json()) as SendResponse;
		return {
			content: [{ type: "text", text: `sent (id: ${data.id})` }],
		};
	});
}

async function runBridgeLoop(args: {
	server: Server;
	serverUrl: string;
	apiKey: string;
	sessionId: string;
	stopped: () => boolean;
	setAbortController: (controller: AbortController | null) => void;
}): Promise<void> {
	let consecutiveFailures = 0;
	let outageNotified = false;

	while (!args.stopped()) {
		const abortController = new AbortController();
		args.setAbortController(abortController);

		try {
			const headers: Record<string, string> = {
				Authorization: `Bearer ${args.apiKey}`,
				Accept: "text/event-stream",
			};
			const lastEventId = readLastEventId(args.sessionId);
			if (lastEventId !== null) {
				headers["Last-Event-ID"] = String(lastEventId);
			}

			const res = await fetch(
				`${args.serverUrl}/messages/${args.sessionId}/stream`,
				{
					headers,
					signal: abortController.signal,
				},
			);

			if (!res.ok || !res.body) {
				throw new Error(
					`SSE connect failed (${res.status}): ${await res.text()}`,
				);
			}

			consecutiveFailures = 0;
			outageNotified = false;

			await consumeSseStream(res.body, async (event) => {
				await handleSseEvent(args.server, args.sessionId, event);
			});

			if (!args.stopped()) {
				throw new Error("SSE stream ended unexpectedly");
			}
		} catch (error) {
			if (args.stopped()) break;

			consecutiveFailures++;
			if (consecutiveFailures >= 5 && !outageNotified) {
				outageNotified = true;
				await emitChannelNotification(
					args.server,
					"agent-comms service unreachable. Inbound messages may be delayed until reconnect.",
					{
						sender: "agent_comms",
						level: "warning",
					},
				);
			}

			const delay = retryDelay(1_000, consecutiveFailures);
			console.error(
				`agent-comms channel reconnect in ${Math.round(delay)}ms: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			await Bun.sleep(delay);
		} finally {
			args.setAbortController(null);
		}
	}
}

async function handleSseEvent(
	server: Server,
	sessionId: string,
	event: SseEvent,
): Promise<void> {
	if (event.event === "heartbeat") return;
	if (event.event && event.event !== "message") return;
	if (!event.data) return;

	const message = JSON.parse(event.data) as Message;
	await emitChannelNotification(server, message.content, {
		sender: "operator",
		message_id: String(message.id),
		timestamp: message.createdAt,
	});

	if (event.id) {
		const parsed = Number(event.id);
		if (Number.isInteger(parsed) && parsed > 0) {
			writeLastEventId(sessionId, parsed);
		}
	}
}

async function emitChannelNotification(
	server: Server,
	content: string,
	meta: Record<string, string>,
): Promise<void> {
	await server.notification({
		method: "notifications/claude/channel",
		params: {
			content,
			meta,
		},
	});
}

function retryDelay(baseMs: number, attempt: number): number {
	const capped = Math.min(baseMs * 2 ** (attempt - 1), 60_000);
	return capped * (0.75 + Math.random() * 0.5);
}

function toolError(message: string) {
	return {
		content: [{ type: "text", text: message }],
		isError: true,
	};
}
