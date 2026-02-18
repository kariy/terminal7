import { ClaudeService } from "./claude-service";
import type { ClaudeServiceLike } from "./claude-service";
import { loadConfig, type ManagerConfig } from "./config";
import { ClaudeJsonlIndexer } from "./jsonl-indexer";
import { GitService } from "./git-service";
import type { GitServiceLike } from "./git-service";
import { jsonResponse, notFound } from "./http-utils";
import { ManagerRepository } from "./repository";
import type { SessionHistoryResult, WsConnectionState, WsSessionState, WsTerminalState } from "./types";
import { log } from "./logger";
import { App } from "./app";
import { createWsHandlers } from "./handlers/ws-handlers";
import { TerminalService, type TerminalServiceLike } from "./terminal-service";
import { shellEscape } from "./utils";

// ── Exported interfaces for test usage ──────────────────────────

export interface IndexerLike {
	refreshIndex(): {
		indexed: number;
		skippedUnchanged: number;
		parseErrors: number;
	};
	readHistory(params: {
		sessionId: string;
		encodedCwd: string;
		cursor?: number;
	}): SessionHistoryResult;
}

export interface ServerDeps {
	config: ManagerConfig;
	repository: ManagerRepository;
	claudeService: ClaudeServiceLike;
	indexer?: IndexerLike;
	terminalService?: TerminalServiceLike;
	gitService?: GitServiceLike;
}

export interface ServerHandle {
	server: ReturnType<typeof Bun.serve>;
	stop(): void;
}

// ── Server factory ──────────────────────────────────────────────

export function createServer(deps: ServerDeps): ServerHandle {
	const { config, repository, claudeService, indexer, terminalService, gitService } = deps;

	const app = new App({ repository, claudeService, config, indexer, gitService });
	const sessionWsHandlers = createWsHandlers(app);

	const server = Bun.serve<WsConnectionState>({
		hostname: config.host,
		port: config.port,
		idleTimeout: 120,
		websocket: {
			open(ws) {
				if (ws.data.kind === "terminal") {
					handleTerminalOpen(ws as Bun.ServerWebSocket<WsTerminalState>);
				} else {
					sessionWsHandlers.open(ws as Bun.ServerWebSocket<WsSessionState>);
				}
			},
			message(ws, rawMessage) {
				if (ws.data.kind === "terminal") {
					handleTerminalMessage(ws as Bun.ServerWebSocket<WsTerminalState>, rawMessage);
				} else {
					sessionWsHandlers.message(ws as Bun.ServerWebSocket<WsSessionState>, rawMessage);
				}
			},
			close(ws) {
				if (ws.data.kind === "terminal") {
					handleTerminalClose(ws as Bun.ServerWebSocket<WsTerminalState>);
				} else {
					sessionWsHandlers.close(ws as Bun.ServerWebSocket<WsSessionState>);
				}
			},
		},
		async fetch(req, serverInstance) {
			const url = new URL(req.url);
			const { pathname } = url;

			if (pathname === "/v1/ws") {
				const upgraded = serverInstance.upgrade(req, {
					data: {
						kind: "session",
						connectionId: crypto.randomUUID(),
						activeRequests: new Set<string>(),
					} satisfies WsSessionState,
				});
				if (upgraded) return;
				return jsonResponse(400, {
					error: {
						code: "upgrade_failed",
						message: "WebSocket upgrade failed",
					},
				});
			}

			if (pathname === "/v1/terminal") {
				return handleTerminalUpgrade(req, url, serverInstance);
			}

			if (pathname === "/v1/ssh") {
				return handleSshUpgrade(req, url, serverInstance);
			}

			if (pathname === "/health") {
				return jsonResponse(200, {
					status: "ok",
					time: new Date().toISOString(),
				});
			}

			if (pathname === "/v1/sessions" && req.method === "GET") {
				return app.listSessions(req);
			}

			if (pathname === "/v1/repos" && req.method === "GET") {
				return app.listRepositories(req);
			}

			if (
				pathname.match(/^\/v1\/sessions\/[^/]+\/history$/) &&
				req.method === "GET"
			) {
				return app.getSessionHistory(req);
			}

			// Serve static assets from public/ (Vite build output)
			const publicDir = new URL("../public/", import.meta.url);
			if (pathname !== "/" && pathname !== "/ssh" && !pathname.startsWith("/sessions/")) {
				const filePath = new URL(`.${pathname}`, publicDir);
				const file = Bun.file(filePath);
				if (await file.exists()) {
					return new Response(file);
				}
				return notFound();
			}

			// SPA fallback: serve index.html for /, /ssh, and /sessions/*
			return new Response(
				Bun.file(new URL("../public/index.html", import.meta.url)),
			);
		},
	});

	// ── Terminal WebSocket handlers ──────────────────────────────

	function handleTerminalUpgrade(
		req: Request,
		url: URL,
		serverInstance: ReturnType<typeof Bun.serve>,
	): Response | undefined {
		const sessionId = url.searchParams.get("session_id");
		const encodedCwd = url.searchParams.get("encoded_cwd");
		const sshDestination = url.searchParams.get("ssh_destination");
		const sshPassword = url.searchParams.get("ssh_password");
		const cols = Number.parseInt(url.searchParams.get("cols") ?? "80", 10);
		const rows = Number.parseInt(url.searchParams.get("rows") ?? "24", 10);

		if (!sessionId || !encodedCwd) {
			return jsonResponse(400, {
				error: {
					code: "invalid_params",
					message: "session_id and encoded_cwd are required",
				},
			});
		}

		if (!sshDestination) {
			return jsonResponse(400, {
				error: {
					code: "invalid_params",
					message: "ssh_destination is required",
				},
			});
		}

		const metadata = repository.getSessionMetadata(sessionId, encodedCwd);
		if (!metadata) {
			return jsonResponse(404, {
				error: {
					code: "session_not_found",
					message: "Session not found",
				},
			});
		}

		const upgraded = serverInstance.upgrade(req, {
			data: {
				kind: "terminal",
				connectionId: crypto.randomUUID(),
				terminal: null,
				sessionId,
				encodedCwd,
				cwd: metadata.cwd,
				sshDestination,
				sshPassword,
				cols: Number.isNaN(cols) ? 80 : cols,
				rows: Number.isNaN(rows) ? 24 : rows,
			} satisfies WsTerminalState,
		});

		if (upgraded) return;
		return jsonResponse(400, {
			error: {
				code: "upgrade_failed",
				message: "WebSocket upgrade failed",
			},
		});
	}

	function handleSshUpgrade(
		req: Request,
		url: URL,
		serverInstance: ReturnType<typeof Bun.serve>,
	): Response | undefined {
		const sshDestination = url.searchParams.get("ssh_destination");
		const sshPassword = url.searchParams.get("ssh_password");
		const cols = Number.parseInt(url.searchParams.get("cols") ?? "80", 10);
		const rows = Number.parseInt(url.searchParams.get("rows") ?? "24", 10);

		if (!sshDestination) {
			return jsonResponse(400, {
				error: {
					code: "invalid_params",
					message: "ssh_destination is required",
				},
			});
		}

		const upgraded = serverInstance.upgrade(req, {
			data: {
				kind: "terminal",
				connectionId: crypto.randomUUID(),
				terminal: null,
				sshDestination,
				sshPassword,
				cols: Number.isNaN(cols) ? 80 : cols,
				rows: Number.isNaN(rows) ? 24 : rows,
			} satisfies WsTerminalState,
		});

		if (upgraded) return;
		return jsonResponse(400, {
			error: {
				code: "upgrade_failed",
				message: "WebSocket upgrade failed",
			},
		});
	}

	function handleTerminalOpen(ws: Bun.ServerWebSocket<WsTerminalState>) {
		const { connectionId, sessionId, cwd, sshDestination, sshPassword, cols, rows } = ws.data;
		log.terminal(`connected connection_id=${connectionId} session_id=${sessionId ?? "(direct ssh)"}`);

		if (!terminalService) {
			ws.send("\r\n[Terminal not available]\r\n");
			ws.close(1008, "Terminal service not available");
			return;
		}

		const remoteCommand = sessionId && cwd
			? `cd ${shellEscape(cwd)} && claude -r ${shellEscape(sessionId)}`
			: undefined;

		let terminal: ReturnType<TerminalServiceLike["open"]>;
		try {
			terminal = terminalService.open({
				sshDestination,
				sshPassword: sshPassword ?? undefined,
				remoteCommand,
				cols,
				rows,
				onData(data) {
					try {
						ws.send(data);
					} catch {
						// WS already closed
					}
				},
				onExit(code) {
					log.terminal(`pty exited connection_id=${connectionId} code=${code}`);
					try {
						ws.close(1000, "Process exited");
					} catch {
						// WS already closed
					}
				},
			});
		} catch (err) {
			log.terminal(`failed to open pty connection_id=${connectionId} error=${err}`);
			ws.send(`\r\n[Terminal error: ${err instanceof Error ? err.message : String(err)}]\r\n`);
			ws.close(1011, "Terminal open failed");
			return;
		}

		ws.data.terminal = terminal;
	}

	function handleTerminalMessage(ws: Bun.ServerWebSocket<WsTerminalState>, rawMessage: string | Buffer) {
		const terminal = ws.data.terminal;
		if (!terminal) return;

		if (typeof rawMessage === "string") {
			// Check if this is a JSON control message (resize)
			if (rawMessage.startsWith("{")) {
				try {
					const parsed = JSON.parse(rawMessage);
					if (parsed && typeof parsed === "object" && parsed.type === "resize") {
						const cols = Number(parsed.cols);
						const rows = Number(parsed.rows);
						if (cols > 0 && rows > 0) {
							terminal.resize(cols, rows);
							return;
						}
					}
				} catch {
					// Not JSON, treat as raw input
				}
			}
			terminal.write(Buffer.from(rawMessage));
		} else {
			terminal.write(Buffer.from(rawMessage));
		}
	}

	function handleTerminalClose(ws: Bun.ServerWebSocket<WsTerminalState>) {
		log.terminal(`disconnected connection_id=${ws.data.connectionId}`);
		ws.data.terminal?.close();
		ws.data.terminal = null;
	}

	function stop() {
		server.stop(true);
		repository.close();
	}

	return { server, stop };
}

// ── Production startup ──────────────────────────────────────────

if (import.meta.main) {
	const { mkdirSync } = await import("fs");
	const { join } = await import("path");

	const config = loadConfig();
	const repository = new ManagerRepository(config.dbPath);
	const indexer = new ClaudeJsonlIndexer(
		config.claudeProjectsDir,
		repository,
		config.maxHistoryMessages,
	);
	const claudeService = new ClaudeService();
	const terminalService = new TerminalService();
	const gitService = new GitService();

	// Ensure projects directories exist
	mkdirSync(join(config.projectsDir, "repos"), { recursive: true });
	mkdirSync(join(config.projectsDir, "worktrees"), { recursive: true });

	const initialStats = indexer.refreshIndex();
	log.index(
		`startup indexed=${initialStats.indexed} skipped=${initialStats.skippedUnchanged} errors=${initialStats.parseErrors}`,
	);

	const handle = createServer({ config, repository, claudeService, indexer, terminalService, gitService });

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

	log.startup(
		`cc-manager listening on http://${config.host}:${handle.server.port}`,
	);
	log.startup(`claude projects directory: ${config.claudeProjectsDir}`);
	log.startup(`git projects directory: ${config.projectsDir}`);
	log.startup(`sqlite database: ${config.dbPath}`);
}
