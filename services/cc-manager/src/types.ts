export interface DeviceRecord {
	deviceId: string;
	deviceName: string;
	tokenSalt: string;
	tokenHash: string;
	refreshSalt: string;
	refreshHash: string;
	createdAt: number;
	lastSeenAt: number;
	revokedAt: number | null;
}

export interface SessionMetadata {
	sessionId: string;
	encodedCwd: string;
	cwd: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	lastActivityAt: number;
	source: "db" | "jsonl" | "merged";
}

export interface SessionSummary extends SessionMetadata {
	messageCount: number;
}

export interface HistoryMessage {
	role: "user" | "assistant";
	text: string;
	uuid?: string;
}

export interface SessionHistoryResult {
	messages: HistoryMessage[];
	nextCursor: number | null;
	totalMessages: number;
}

export interface JsonlIndexUpdate {
	sessionId: string;
	encodedCwd: string;
	cwd: string;
	title: string;
	lastActivityAt: number;
	messageCount: number;
	jsonlPath: string;
	fileSize: number;
	fileMtimeMs: number;
}
