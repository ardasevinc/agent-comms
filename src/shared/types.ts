export interface AgentIdentity {
	agentType: "claude" | "codex" | "unknown";
	sessionId: string;
	hostname: string;
	project: string;
}

export interface Message {
	id: number;
	sessionId: string;
	agentType: string;
	hostname: string;
	project: string;
	direction: "agent_to_human" | "human_to_agent";
	content: string;
	telegramMessageId: number | null;
	createdAt: string;
	readAt: string | null;
}

export interface SendRequest {
	identity: AgentIdentity;
	content: string;
}

export interface SendResponse {
	id: number;
	telegramMessageId: number | null;
}

export interface CheckResponse {
	messages: Message[];
}

export interface HistoryResponse {
	messages: Message[];
}
