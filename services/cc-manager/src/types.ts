export interface SessionMetadata {
	sessionId: string;
	encodedCwd: string;
	cwd: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	lastActivityAt: number;
	source: "db" | "jsonl" | "merged";
	totalCostUsd: number;
}

export interface SessionSummary extends SessionMetadata {
	messageCount: number;
}

export interface HistoryMessage {
	role: "user" | "assistant";
	text: string;
	content_blocks?: unknown[];
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

// ── WebSocket session metadata (wire format) ────────────────────

export interface WsSessionMeta {
	session_id: string;
	encoded_cwd: string;
	cwd: string;
	title: string;
	created_at: number;
	updated_at: number;
	last_activity_at: number;
	source: string;
	total_cost_usd: number;
}

export function toWsSessionMeta(m: SessionMetadata): WsSessionMeta {
	return {
		session_id: m.sessionId,
		encoded_cwd: m.encodedCwd,
		cwd: m.cwd,
		title: m.title,
		created_at: m.createdAt,
		updated_at: m.updatedAt,
		last_activity_at: m.lastActivityAt,
		source: m.source,
		total_cost_usd: m.totalCostUsd,
	};
}

// ── WebSocket server→client messages ────────────────────────────

export interface WsHelloMessage {
	type: "hello";
	requires_auth: boolean;
	server_time: number;
}

export interface WsSessionCreatedMessage {
	type: "session.created";
	request_id: string;
	session_id: string;
	encoded_cwd: string;
	cwd: string;
	session?: WsSessionMeta;
}

export interface WsSessionStateMessage {
	type: "session.state";
	request_id?: string;
	session_id?: string;
	encoded_cwd?: string;
	status: string;
	stats?: unknown;
	session?: WsSessionMeta;
}

export interface WsStreamMessageMessage {
	type: "stream.message";
	request_id: string;
	session_id?: string;
	sdk_message: unknown;
	session?: WsSessionMeta;
}

export interface WsStreamDoneMessage {
	type: "stream.done";
	request_id: string;
	session_id?: string;
	encoded_cwd: string;
	session?: WsSessionMeta;
}

export interface WsErrorMessage {
	type: "error";
	code: string;
	message: string;
	request_id?: string;
	details?: unknown;
}

export interface WsPongMessage {
	type: "pong";
	server_time: number;
}

export type WsServerMessage =
	| WsHelloMessage
	| WsSessionCreatedMessage
	| WsSessionStateMessage
	| WsStreamMessageMessage
	| WsStreamDoneMessage
	| WsErrorMessage
	| WsPongMessage;

// ── HTTP response bodies ────────────────────────────────────────

export interface SessionListItem {
	session_id: string;
	encoded_cwd: string;
	cwd: string;
	title: string;
	created_at: number;
	updated_at: number;
	last_activity_at: number;
	source: string;
	message_count: number;
	total_cost_usd: number;
}

export interface SessionListResponse {
	sessions: SessionListItem[];
}

export interface SessionHistoryResponse {
	session_id: string;
	encoded_cwd: string;
	messages: HistoryMessage[];
	next_cursor: number | null;
	total_messages: number;
}

export interface HealthResponse {
	status: string;
	time: string;
}

// ── WebSocket connection state ───────────────────────────────────

import type { TerminalHandle } from "./terminal-service";

export interface WsSessionState {
	kind: "session";
	connectionId: string;
	activeRequests: Set<string>;
}

export interface WsTerminalState {
	kind: "terminal";
	connectionId: string;
	terminal: TerminalHandle | null;
	sessionId: string;
	encodedCwd: string;
	cwd: string;
	sshDestination: string;
	sshPassword: string | null;
	cols: number;
	rows: number;
}

export type WsConnectionState = WsSessionState | WsTerminalState;

// ── Internal param types ────────────────────────────────────────

export interface HandlePromptParams {
	requestId: string;
	prompt: string;
	cwd: string;
	encodedCwd: string;
	resumeSessionId?: string;
	titleHint?: string;
}
