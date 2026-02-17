import type { App } from "../app";
import type { HandlePromptParams, WsConnectionState } from "../types";
import { nowMs, truncate } from "../utils";
import { wsError, wsSend } from "../ws-utils";
import { log } from "../logger";

export function createPromptHandler(app: App) {

	return async function handlePromptMessage(
		ws: Bun.ServerWebSocket<WsConnectionState>,
		params: HandlePromptParams,
	): Promise<void> {
		let resolvedSessionId = params.resumeSessionId;

		ws.data.activeRequests.add(params.requestId);
		let streamedChars = 0;
		let totalCostUsd = 0;

		await app.claudeService.streamPrompt({
			requestId: params.requestId,
			prompt: params.prompt,
			cwd: params.cwd,
			resumeSessionId: params.resumeSessionId,
			allowedTools: app.config.allowedTools,
			onSessionId: (sessionId) => {
				resolvedSessionId = sessionId;

				const sessionTitle = truncate(
					params.titleHint ?? params.prompt.replace(/\s+/g, " "),
					120,
				);

				const metadata = app.repository.upsertSessionMetadata({
					sessionId,
					source: "db",
					cwd: params.cwd,
					title: sessionTitle,
					encodedCwd: params.encodedCwd,
				});

				const eventType = params.resumeSessionId
					? "session_resumed"
					: "session_created";

				app.repository.recordEvent({
					sessionId,
					eventType,
					encodedCwd: params.encodedCwd,
					payload: {
						cwd: params.cwd,
						title: metadata.title,
						device_id: "local",
					},
				});

				if (params.resumeSessionId) {
					wsSend(ws, {
						type: "session.state",
						request_id: params.requestId,
						session_id: sessionId,
						encoded_cwd: params.encodedCwd,
						status: "session_resumed",
					});
				}

				if (!params.resumeSessionId) {
					log.session(
						`created session_id=${sessionId} connection_id=${ws.data.connectionId}`,
					);
					wsSend(ws, {
						type: "session.created",
						request_id: params.requestId,
						session_id: sessionId,
						encoded_cwd: params.encodedCwd,
						cwd: params.cwd,
					});
				}
			},
			onMessage: (message) => {
				if (
					message.type === "stream_event" &&
					message.event.type === "content_block_delta" &&
					message.event.delta.type === "text_delta"
				) {
					streamedChars += message.event.delta.text.length;
				}

				if (
					message.type === "result" &&
					typeof (message as any).total_cost_usd === "number"
				) {
					totalCostUsd = (message as any).total_cost_usd;
				}

				wsSend(ws, {
					type: "stream.message",
					request_id: params.requestId,
					session_id: resolvedSessionId,
					sdk_message: message,
				});
			},
			onDone: () => {
				log.session(`On done. sessionId=${resolvedSessionId}`);

				if (resolvedSessionId) {
					app.repository.upsertSessionMetadata({
						sessionId: resolvedSessionId,
						encodedCwd: params.encodedCwd,
						cwd: params.cwd,
						title: truncate(
							params.titleHint ?? params.prompt.replace(/\s+/g, " "),
							120,
						),
						lastActivityAt: nowMs(),
						source: "db",
						costToAdd: totalCostUsd,
					});
					app.repository.recordEvent({
						sessionId: resolvedSessionId,
						encodedCwd: params.encodedCwd,
						eventType: "prompt_completed",
						payload: {
							request_id: params.requestId,
							streamed_chars: streamedChars,
							total_cost_usd: totalCostUsd,
							device_id: "local",
						},
					});
				}
				wsSend(ws, {
					type: "stream.done",
					request_id: params.requestId,
					session_id: resolvedSessionId,
					encoded_cwd: params.encodedCwd,
				});
			},
			onError: (error) => {
				log.session(`On error. sessionId=${resolvedSessionId}`);

				if (resolvedSessionId) {
					app.repository.recordEvent({
						sessionId: resolvedSessionId,
						encodedCwd: params.encodedCwd,
						eventType: "prompt_error",
						payload: {
							request_id: params.requestId,
							error: String(error),
							device_id: "local",
						},
					});
				}
				wsError(ws, String(error), "prompt_failed", params.requestId);
			},
		});

		ws.data.activeRequests.delete(params.requestId);
	};
}
