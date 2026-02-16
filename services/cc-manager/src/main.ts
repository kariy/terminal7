import { ClaudeService } from "./claude-service";
import { loadConfig } from "./config";
import { ClaudeJsonlIndexer } from "./jsonl-indexer";
import { AuthService } from "./auth";
import { badRequest, jsonResponse, notFound, safeJson, unauthorized } from "./http-utils";
import { ManagerRepository } from "./repository";
import {
	RegisterDeviceBodySchema,
	WsClientMessageSchema,
} from "./schemas";
import type { DeviceRecord } from "./types";
import { log } from "./logger";
import { encodeCwd, nowMs, truncate } from "./utils";

const config = loadConfig();
const repository = new ManagerRepository(config.dbPath);
const authService = new AuthService(repository);
const indexer = new ClaudeJsonlIndexer(
	config.claudeProjectsDir,
	repository,
	config.maxHistoryMessages,
);
const claudeService = new ClaudeService();

const initialStats = indexer.refreshIndex();
log.index(
	`startup indexed=${initialStats.indexed} skipped=${initialStats.skippedUnchanged} errors=${initialStats.parseErrors}`,
);

interface WsConnectionState {
	connectionId: string;
	device: DeviceRecord | null;
	isAuthed: boolean;
	activeRequests: Set<string>;
}

const WS_LOG_PAYLOAD_MAX_CHARS = 4000;

function formatWsLogPayload(raw: string): string {
	if (raw.length <= WS_LOG_PAYLOAD_MAX_CHARS) return raw;
	return `${raw.slice(0, WS_LOG_PAYLOAD_MAX_CHARS - 3)}...`;
}

function wsError(
	ws: Bun.ServerWebSocket<WsConnectionState>,
	message: string,
	code: string,
	requestId?: string,
	details?: unknown,
): void {
	wsSend(ws, {
		type: "error",
		code,
		message,
		...(requestId ? { request_id: requestId } : {}),
		...(details !== undefined ? { details } : {}),
	});
}

function wsSend(ws: Bun.ServerWebSocket<WsConnectionState>, payload: unknown): void {
	const serialized =
		typeof payload === "string" ? payload : JSON.stringify(payload);
	log.wsSend(
		`connection_id=${ws.data.connectionId} payload=${formatWsLogPayload(serialized)}`,
	);
	ws.send(serialized);
}

function parseJsonText(raw: string): unknown | null {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function getSessionRouteMatch(pathname: string): {
	sessionId: string;
	action: "history";
} | null {
	const history = pathname.match(/^\/v1\/sessions\/([^/]+)\/history$/);
	if (history) {
		const sessionId = history[1];
		if (!sessionId) return null;
		return {
			sessionId: decodeURIComponent(sessionId),
			action: "history",
		};
	}

	return null;
}

async function handlePromptMessage(
	ws: Bun.ServerWebSocket<WsConnectionState>,
	params: {
		requestId: string;
		prompt: string;
		cwd: string;
		encodedCwd: string;
		resumeSessionId?: string;
		titleHint?: string;
	},
): Promise<void> {
	const device = ws.data.device;
	if (!device) {
		wsError(ws, "Unauthorized", "unauthorized", params.requestId);
		return;
	}

	let resolvedSessionId = params.resumeSessionId;

	ws.data.activeRequests.add(params.requestId);
	let streamedChars = 0;

	await claudeService.streamPrompt({
		requestId: params.requestId,
		prompt: params.prompt,
		cwd: params.cwd,
		resumeSessionId: params.resumeSessionId,
		allowedTools: config.allowedTools,
		onSessionId: (sessionId) => {
			resolvedSessionId = sessionId;
			const metadata = repository.upsertSessionMetadata({
				sessionId,
				encodedCwd: params.encodedCwd,
				cwd: params.cwd,
				title: truncate(params.titleHint ?? params.prompt.replace(/\s+/g, " "), 120),
				source: "db",
			});

			repository.recordEvent({
				sessionId,
				encodedCwd: params.encodedCwd,
				eventType: params.resumeSessionId ? "session_resumed" : "session_created",
				payload: {
					device_id: device.deviceId,
					cwd: params.cwd,
					title: metadata.title,
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
					`created session_id=${sessionId} connection_id=${ws.data.connectionId} device_id=${device.deviceId}`,
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
		onDelta: (text) => {
			streamedChars += text.length;
			wsSend(ws, {
				type: "stream.delta",
				request_id: params.requestId,
				session_id: resolvedSessionId,
				text,
			});
		},
		onDone: () => {
			if (resolvedSessionId) {
				repository.upsertSessionMetadata({
					sessionId: resolvedSessionId,
					encodedCwd: params.encodedCwd,
					cwd: params.cwd,
					title: truncate(params.titleHint ?? params.prompt.replace(/\s+/g, " "), 120),
					lastActivityAt: nowMs(),
					source: "db",
				});
				repository.recordEvent({
					sessionId: resolvedSessionId,
					encodedCwd: params.encodedCwd,
					eventType: "prompt_completed",
					payload: {
						request_id: params.requestId,
						streamed_chars: streamedChars,
						device_id: device.deviceId,
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
			if (resolvedSessionId) {
				repository.recordEvent({
					sessionId: resolvedSessionId,
					encodedCwd: params.encodedCwd,
					eventType: "prompt_error",
					payload: {
						request_id: params.requestId,
						error: String(error),
						device_id: device.deviceId,
					},
				});
			}
			wsError(
				ws,
				String(error),
				"prompt_failed",
				params.requestId,
			);
		},
	});

	ws.data.activeRequests.delete(params.requestId);
}

function authenticateForRoute(req: Request): DeviceRecord | Response {
	const device = authService.authenticateRequest(req);
	if (!device) return unauthorized();
	return device;
}

const server = Bun.serve<WsConnectionState>({
	hostname: config.host,
	port: config.port,
	idleTimeout: 120,
	async fetch(req, serverInstance) {
		const url = new URL(req.url);
		const { pathname } = url;

		if (pathname === "/v1/ws") {
			const upgraded = serverInstance.upgrade(req, {
				data: {
					connectionId: crypto.randomUUID(),
					device: null,
					isAuthed: false,
					activeRequests: new Set<string>(),
				},
			});
			if (upgraded) return;
			return jsonResponse(400, {
				error: {
					code: "upgrade_failed",
					message: "WebSocket upgrade failed",
				},
			});
		}

		if (pathname === "/health") {
			return jsonResponse(200, {
				status: "ok",
				time: new Date().toISOString(),
			});
		}

		if (pathname === "/v1/bootstrap/register-device" && req.method === "POST") {
			const body = await safeJson(req);
			const parsed = RegisterDeviceBodySchema.safeParse(body ?? {});
			if (!parsed.success) {
				return badRequest("Invalid register-device payload", parsed.error.format());
			}

			if (
				config.bootstrapNonce &&
				parsed.data.bootstrap_nonce !== config.bootstrapNonce
			) {
				return jsonResponse(403, {
					error: {
						code: "bootstrap_forbidden",
						message: "Invalid bootstrap nonce",
					},
				});
			}

			const registration = repository.registerDevice(
				parsed.data.device_name ?? `ios-${crypto.randomUUID().slice(0, 8)}`,
			);
			return jsonResponse(201, {
				device_id: registration.deviceId,
				access_token: registration.accessToken,
				refresh_token: registration.refreshToken,
				issued_at: nowMs(),
			});
		}

			if (pathname === "/v1/sessions" && req.method === "GET") {
				const auth = authenticateForRoute(req);
				if (auth instanceof Response) return auth;

				if (url.searchParams.get("refresh") === "1") {
					indexer.refreshIndex();
				}
				const sessions = repository.listSessions();
				return jsonResponse(200, {
					sessions: sessions.map((session) => ({
						session_id: session.sessionId,
						encoded_cwd: session.encodedCwd,
						cwd: session.cwd,
						title: session.title,
						created_at: session.createdAt,
						updated_at: session.updatedAt,
						last_activity_at: session.lastActivityAt,
						source: session.source,
						message_count: session.messageCount,
					})),
				});
			}

			const sessionRoute = getSessionRouteMatch(pathname);
			if (sessionRoute) {
				const auth = authenticateForRoute(req);
				if (auth instanceof Response) return auth;

				if (sessionRoute.action === "history" && req.method === "GET") {
					const encodedCwdParam = url.searchParams.get("encoded_cwd");
					const sessionCandidates = repository.findSessionCandidates(
						sessionRoute.sessionId,
					);
					const chosen = encodedCwdParam
						? sessionCandidates.find((candidate) => candidate.encodedCwd === encodedCwdParam)
						: sessionCandidates[0];
					if (!chosen) {
						return jsonResponse(404, {
							error: {
								code: "session_not_found",
								message: "Session not found",
							},
						});
					}

					const cursorRaw = url.searchParams.get("cursor");
					const cursor = cursorRaw ? Number.parseInt(cursorRaw, 10) : undefined;
					const history = indexer.readHistory({
						sessionId: sessionRoute.sessionId,
						encodedCwd: chosen.encodedCwd,
						cursor: Number.isNaN(cursor as number) ? undefined : cursor,
					});

					return jsonResponse(200, {
						session_id: sessionRoute.sessionId,
						encoded_cwd: chosen.encodedCwd,
						messages: history.messages,
						next_cursor: history.nextCursor,
						total_messages: history.totalMessages,
					});
				}
			}

		return notFound();
	},
	websocket: {
		open(ws) {
			log.ws(`connected connection_id=${ws.data.connectionId}`);
			wsSend(ws, {
				type: "hello",
				requires_auth: true,
				server_time: nowMs(),
			});
		},
		async message(ws, rawMessage) {
			const text = typeof rawMessage === "string" ? rawMessage : rawMessage.toString();
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
				wsError(ws, "Invalid message payload", "invalid_payload", undefined, parsed.error.format());
				return;
			}

			const message = parsed.data;
			if (message.type !== "auth.init" && !ws.data.isAuthed) {
				wsError(ws, "Authentication required", "unauthorized");
				return;
			}

			switch (message.type) {
				case "auth.init": {
					const device = authService.authenticateToken(message.token);
					if (!device) {
						wsError(ws, "Invalid access token", "unauthorized");
						return;
					}
					ws.data.device = device;
					ws.data.isAuthed = true;
					wsSend(ws, {
						type: "auth.ok",
						device_id: device.deviceId,
						device_name: device.deviceName,
					});
					return;
				}

				case "session.create": {
					const requestId = message.request_id ?? crypto.randomUUID();
					const cwd = message.cwd ?? process.cwd();
					const encodedCwd = encodeCwd(cwd);
					void handlePromptMessage(ws, {
						requestId,
						prompt: message.prompt,
						cwd,
						encodedCwd,
						titleHint: message.title,
					});
					return;
				}

				case "session.resume":
				case "session.send": {
					const metadata = repository.getSessionMetadata(
						message.session_id,
						message.encoded_cwd,
					);
					const cwd = message.cwd ?? metadata?.cwd ?? process.cwd();
					const requestId = message.request_id ?? crypto.randomUUID();
					void handlePromptMessage(ws, {
						requestId,
						prompt: message.prompt,
						cwd,
						encodedCwd: message.encoded_cwd,
						resumeSessionId: message.session_id,
					});
					return;
				}

				case "session.stop": {
					const stopped = claudeService.stopRequest(message.request_id);
					wsSend(ws, {
						type: "session.state",
						request_id: message.request_id,
						status: stopped ? "stopped" : "not_found",
					});
					ws.data.activeRequests.delete(message.request_id);
					return;
				}

				case "session.refresh_index": {
					const stats = indexer.refreshIndex();
					wsSend(ws, {
						type: "session.state",
						status: "index_refreshed",
						stats,
					});
					return;
				}

				case "ping": {
					wsSend(ws, {
						type: "pong",
						server_time: nowMs(),
					});
					return;
				}
			}
		},
		close(ws) {
			for (const requestId of ws.data.activeRequests) {
				claudeService.stopRequest(requestId);
			}
			ws.data.activeRequests.clear();
		},
	},
});

const indexInterval = setInterval(() => {
	const stats = indexer.refreshIndex();
	if (stats.indexed > 0 || stats.parseErrors > 0) {
		log.index(
			`indexed=${stats.indexed} skipped=${stats.skippedUnchanged} errors=${stats.parseErrors}`,
		);
	}
}, 15000);

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		clearInterval(indexInterval);
		server.stop(true);
		repository.close();
		process.exit(0);
	});
}

log.startup(`cc-manager listening on http://${config.host}:${config.port}`);
log.startup(`claude projects directory: ${config.claudeProjectsDir}`);
log.startup(`sqlite database: ${config.dbPath}`);
