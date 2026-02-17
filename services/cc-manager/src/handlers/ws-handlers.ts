import type { App } from "../app";
import { WsClientMessageSchema, type WsClientMessage } from "../schemas";
import type { WsConnectionState } from "../types";
import { encodeCwd, nowMs } from "../utils";
import { formatWsLogPayload, parseJsonText, wsError, wsSend } from "../ws-utils";
import { log } from "../logger";
import { createPromptHandler } from "./prompt-handler";

export function createWsHandlers(app: App) {
	const handlePromptMessage = createPromptHandler(app);

	type WsHandler = (ws: Bun.ServerWebSocket<WsConnectionState>, message: WsClientMessage) => void;

	function handleSessionCreate(ws: Bun.ServerWebSocket<WsConnectionState>, message: WsClientMessage) {
		if (message.type !== "session.create") return;
		log.ws("Session created.");

		const requestId = message.request_id ?? crypto.randomUUID();
		const cwd = message.cwd ?? app.config.defaultCwd;
		const encodedCwd = encodeCwd(cwd);

		void handlePromptMessage(ws, {
			requestId,
			prompt: message.prompt,
			cwd,
			encodedCwd,
			titleHint: message.title,
		});
	}

	function handleSessionResumeOrSend(ws: Bun.ServerWebSocket<WsConnectionState>, message: WsClientMessage) {
		if (message.type !== "session.resume" && message.type !== "session.send") return;

		if (!message.session_id) {
			wsError(ws, "session_id is required", "invalid_payload", message.request_id);
			return;
		}

		log.ws("Resuming session.");

		const metadata = app.repository.getSessionMetadata(
			message.session_id,
			message.encoded_cwd,
		);

		if (!metadata) {
			wsError(ws, "Session not found", "session_not_found", message.request_id);
			return;
		}

		const cwd = metadata.cwd;
		const requestId = message.request_id ?? crypto.randomUUID();

		void handlePromptMessage(ws, {
			cwd,
			requestId,
			prompt: message.prompt,
			encodedCwd: message.encoded_cwd,
			resumeSessionId: message.session_id,
		});
	}

	function handleSessionStop(ws: Bun.ServerWebSocket<WsConnectionState>, message: WsClientMessage) {
		if (message.type !== "session.stop") return;

		const stopped = app.claudeService.stopRequest(message.request_id);
		wsSend(ws, {
			type: "session.state",
			request_id: message.request_id,
			status: stopped ? "stopped" : "not_found",
		});
		ws.data.activeRequests.delete(message.request_id);
	}

	function handleRefreshIndex(ws: Bun.ServerWebSocket<WsConnectionState>, _message: WsClientMessage) {
		const stats = app.indexer
			? app.indexer.refreshIndex()
			: { indexed: 0, skippedUnchanged: 0, parseErrors: 0 };
		wsSend(ws, {
			type: "session.state",
			status: "index_refreshed",
			stats,
		});
	}

	function handlePing(ws: Bun.ServerWebSocket<WsConnectionState>, _message: WsClientMessage) {
		wsSend(ws, {
			type: "pong",
			server_time: nowMs(),
		});
	}

	const handlers: Record<string, WsHandler> = {
		"session.create": handleSessionCreate,
		"session.resume": handleSessionResumeOrSend,
		"session.send": handleSessionResumeOrSend,
		"session.stop": handleSessionStop,
		"session.refresh_index": handleRefreshIndex,
		"ping": handlePing,
	};

	return {
		open(ws: Bun.ServerWebSocket<WsConnectionState>) {
			log.ws(`connected connection_id=${ws.data.connectionId}`);
			wsSend(ws, {
				type: "hello",
				requires_auth: false,
				server_time: nowMs(),
			});
		},

		async message(ws: Bun.ServerWebSocket<WsConnectionState>, rawMessage: string | Buffer) {
			const text =
				typeof rawMessage === "string"
					? rawMessage
					: rawMessage.toString();

			log.wsRecv(
				`connection_id=${ws.data.connectionId} payload=${formatWsLogPayload(text)}`,
			);

			const payload = parseJsonText(text);
			if (!payload) {
				wsError(ws, "Invalid JSON message", "invalid_json");
				return;
			}

			const parsed = WsClientMessageSchema.safeParse(payload);
			if (!parsed.success) {
				wsError(
					ws,
					"Invalid message payload",
					"invalid_payload",
					undefined,
					parsed.error.format(),
				);
				return;
			}

			const message = parsed.data;
			const handler = handlers[message.type];
			if (handler) {
				handler(ws, message);
			}
		},

		close(ws: Bun.ServerWebSocket<WsConnectionState>) {
			for (const requestId of ws.data.activeRequests) {
				app.claudeService.stopRequest(requestId);
			}
			ws.data.activeRequests.clear();
		},
	};
}
