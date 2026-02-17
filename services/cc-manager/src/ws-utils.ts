import { log } from "./logger";
import type { WsConnectionState, WsErrorMessage, WsServerMessage } from "./types";

const WS_LOG_PAYLOAD_MAX_CHARS = 4000;

export function formatWsLogPayload(raw: string): string {
	if (raw.length <= WS_LOG_PAYLOAD_MAX_CHARS) return raw;
	return `${raw.slice(0, WS_LOG_PAYLOAD_MAX_CHARS - 3)}...`;
}

export function wsSend(
	ws: Bun.ServerWebSocket<WsConnectionState>,
	payload: WsServerMessage,
): void {
	const serialized =
		typeof payload === "string" ? payload : JSON.stringify(payload);
	log.wsSend(
		`connection_id=${ws.data.connectionId} payload=${formatWsLogPayload(serialized)}`,
	);
	ws.send(serialized);
}

export function wsError(
	ws: Bun.ServerWebSocket<WsConnectionState>,
	message: string,
	code: string,
	requestId?: string,
	details?: unknown,
): void {
	const msg: WsErrorMessage = { type: "error", code, message };
	if (requestId) msg.request_id = requestId;
	if (details !== undefined) msg.details = details;
	wsSend(ws, msg);
}

export function parseJsonText(raw: string): unknown | null {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
