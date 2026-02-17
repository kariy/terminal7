import { ClaudeService } from "./claude-service";
import type { ClaudeServiceLike } from "./claude-service";
import { loadConfig, type ManagerConfig } from "./config";
import { ClaudeJsonlIndexer } from "./jsonl-indexer";
import { jsonResponse, notFound } from "./http-utils";
import { ManagerRepository } from "./repository";
import { WsClientMessageSchema } from "./schemas";
import type {
	HandlePromptParams,
	SessionHistoryResult,
	WsErrorMessage,
	WsServerMessage,
} from "./types";
import { log } from "./logger";
import { encodeCwd, nowMs, truncate } from "./utils";

// ── Exported interfaces for test usage ──────────────────────────

export interface IndexerLike {
	refreshIndex(): { indexed: number; skippedUnchanged: number; parseErrors: number };
	readHistory(params: { sessionId: string; encodedCwd: string; cursor?: number }): SessionHistoryResult;
}

export interface ServerDeps {
	config: ManagerConfig;
	repository: ManagerRepository;
	claudeService: ClaudeServiceLike;
	indexer?: IndexerLike;
}

export interface ServerHandle {
	server: ReturnType<typeof Bun.serve>;
	stop(): void;
}

// ── Pure helper functions (no module-level deps) ────────────────

interface WsConnectionState {
	connectionId: string;
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
	const msg: WsErrorMessage = { type: "error", code, message };
	if (requestId) msg.request_id = requestId;
	if (details !== undefined) msg.details = details;
	wsSend(ws, msg);
}

function wsSend(
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

// ── Server factory ──────────────────────────────────────────────

export function createServer(deps: ServerDeps): ServerHandle {
	const { config, repository, claudeService, indexer } = deps;

	async function handlePromptMessage(
		ws: Bun.ServerWebSocket<WsConnectionState>,
		params: HandlePromptParams,
	): Promise<void> {
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

				const sessionTitle = truncate(
					params.titleHint ?? params.prompt.replace(/\s+/g, " "),
					120,
				);

				const metadata = repository.upsertSessionMetadata({
					sessionId,
					source: "db",
					cwd: params.cwd,
					title: sessionTitle,
					encodedCwd: params.encodedCwd,
				});

				const eventType = params.resumeSessionId
					? "session_resumed"
					: "session_created";

				repository.recordEvent({
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
					repository.upsertSessionMetadata({
						sessionId: resolvedSessionId,
						encodedCwd: params.encodedCwd,
						cwd: params.cwd,
						title: truncate(
							params.titleHint ?? params.prompt.replace(/\s+/g, " "),
							120,
						),
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
					repository.recordEvent({
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

			if (pathname === "/v1/sessions" && req.method === "GET") {
				if (indexer && url.searchParams.get("refresh") === "1") {
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
				if (sessionRoute.action === "history" && req.method === "GET") {
					const encodedCwdParam = url.searchParams.get("encoded_cwd");
					const sessionCandidates = repository.findSessionCandidates(
						sessionRoute.sessionId,
					);
					const chosen = encodedCwdParam
						? sessionCandidates.find(
								(candidate) =>
									candidate.encodedCwd === encodedCwdParam,
							)
						: sessionCandidates[0];
					if (!chosen) {
						return jsonResponse(404, {
							error: {
								code: "session_not_found",
								message: "Session not found",
							},
						});
					}

					if (!indexer) {
						return jsonResponse(501, {
							error: {
								code: "not_implemented",
								message: "History endpoint requires indexer",
							},
						});
					}

					const cursorRaw = url.searchParams.get("cursor");
					const cursor = cursorRaw
						? Number.parseInt(cursorRaw, 10)
						: undefined;
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

			// Serve static assets from public/ (Vite build output)
			const publicDir = new URL("../public/", import.meta.url);
			if (pathname !== "/" && !pathname.startsWith("/sessions/")) {
				const filePath = new URL(`.${pathname}`, publicDir);
				const file = Bun.file(filePath);
				if (await file.exists()) {
					return new Response(file);
				}
				return notFound();
			}

			// SPA fallback: serve index.html for / and /sessions/*
			return new Response(
				Bun.file(new URL("../public/index.html", import.meta.url)),
			);
		},
		websocket: {
			open(ws) {
				log.ws(`connected connection_id=${ws.data.connectionId}`);
				wsSend(ws, {
					type: "hello",
					requires_auth: false,
					server_time: nowMs(),
				});
			},
			async message(ws, rawMessage) {
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

				switch (message.type) {
					case "session.create": {
						log.ws(`Session created.`);

						const requestId = message.request_id ?? crypto.randomUUID();
						const cwd = message.cwd ?? config.defaultCwd;
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
						if (!message.session_id) {
							wsError(
								ws,
								"session_id is required",
								"invalid_payload",
								message.request_id,
							);
							return;
						}

						log.ws("Resuming session.");

						const metadata = repository.getSessionMetadata(
							message.session_id,
							message.encoded_cwd,
						);

						if (!metadata) {
							wsError(
								ws,
								"Session not found",
								"session_not_found",
								message.request_id,
							);
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

						return;
					}

					case "session.stop": {
						const stopped = claudeService.stopRequest(
							message.request_id,
						);
						wsSend(ws, {
							type: "session.state",
							request_id: message.request_id,
							status: stopped ? "stopped" : "not_found",
						});
						ws.data.activeRequests.delete(message.request_id);
						return;
					}

					case "session.refresh_index": {
						const stats = indexer
							? indexer.refreshIndex()
							: { indexed: 0, skippedUnchanged: 0, parseErrors: 0 };
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

	function stop() {
		server.stop(true);
		repository.close();
	}

	return { server, stop };
}

// ── Production startup ──────────────────────────────────────────

if (import.meta.main) {
	const config = loadConfig();
	const repository = new ManagerRepository(config.dbPath);
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

	const handle = createServer({ config, repository, claudeService, indexer });

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
			handle.stop();
			process.exit(0);
		});
	}

	log.startup(`cc-manager listening on http://${config.host}:${handle.server.port}`);
	log.startup(`claude projects directory: ${config.claudeProjectsDir}`);
	log.startup(`sqlite database: ${config.dbPath}`);
}
