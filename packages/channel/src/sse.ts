export interface SseEvent {
	event?: string;
	data: string;
	id?: string;
	retry?: number;
}

export async function consumeSseStream(
	stream: ReadableStream,
	onEvent: (event: SseEvent) => Promise<void> | void,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const parsed = parseSseBuffer(buffer);
			buffer = parsed.rest;

			for (const event of parsed.events) {
				await onEvent(event);
			}
		}

		if (buffer.trim().length > 0) {
			const trailing = parseEventBlock(buffer);
			if (trailing) {
				await onEvent(trailing);
			}
		}
	} finally {
		reader.releaseLock();
	}
}

export function parseSseBuffer(buffer: string): {
	events: SseEvent[];
	rest: string;
} {
	const normalized = normalizeNewlines(buffer);
	const events: SseEvent[] = [];
	let rest = normalized;

	while (true) {
		const boundary = rest.indexOf("\n\n");
		if (boundary < 0) break;

		const block = rest.slice(0, boundary);
		rest = rest.slice(boundary + 2);
		const event = parseEventBlock(block);
		if (event) events.push(event);
	}

	return { events, rest };
}

export function parseEventBlock(block: string): SseEvent | null {
	const event: SseEvent = { data: "" };

	for (const line of normalizeNewlines(block).split("\n")) {
		if (line === "" || line.startsWith(":")) continue;

		const separator = line.indexOf(":");
		const field = separator >= 0 ? line.slice(0, separator) : line;
		let value = separator >= 0 ? line.slice(separator + 1) : "";
		if (value.startsWith(" ")) value = value.slice(1);

		switch (field) {
			case "event":
				event.event = value;
				break;
			case "data":
				event.data =
					event.data.length === 0 ? value : `${event.data}\n${value}`;
				break;
			case "id":
				event.id = value;
				break;
			case "retry":
				event.retry = Number(value);
				break;
			default:
				break;
		}
	}

	if (
		event.data.length === 0 &&
		event.event === undefined &&
		event.id === undefined &&
		event.retry === undefined
	) {
		return null;
	}

	return event;
}

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
