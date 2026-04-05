import type { Message } from "@agent-comms/shared/types";

type SessionCallback = (message: Message) => Promise<void> | void;

const sessionStreams = new Map<string, Set<SessionCallback>>();

export function registerSessionStream(
	sessionId: string,
	callback: SessionCallback,
): () => void {
	let listeners = sessionStreams.get(sessionId);
	if (!listeners) {
		listeners = new Set();
		sessionStreams.set(sessionId, listeners);
	}
	listeners.add(callback);

	return () => {
		const current = sessionStreams.get(sessionId);
		if (!current) return;
		current.delete(callback);
		if (current.size === 0) {
			sessionStreams.delete(sessionId);
		}
	};
}

export async function pushToSession(
	sessionId: string,
	message: Message,
): Promise<void> {
	const listeners = sessionStreams.get(sessionId);
	if (!listeners || listeners.size === 0) return;

	const deliveries = [...listeners].map(async (listener) => {
		try {
			await listener(message);
		} catch (error) {
			console.error(
				`Failed to push message ${message.id} to session ${sessionId}:`,
				error,
			);
		}
	});

	await Promise.all(deliveries);
}

export function clearSessionStreams(): void {
	sessionStreams.clear();
}
