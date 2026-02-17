import { ClaudeService } from "./claude-service";
import type { ClaudeServiceLike } from "./claude-service";
import { loadConfig, type ManagerConfig } from "./config";
import { ClaudeJsonlIndexer } from "./jsonl-indexer";
import { jsonResponse, notFound } from "./http-utils";
import { ManagerRepository } from "./repository";
import type { SessionHistoryResult, WsConnectionState } from "./types";
import { log } from "./logger";
import { App } from "./app";
import { createWsHandlers } from "./handlers/ws-handlers";

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
}

export interface ServerHandle {
	server: ReturnType<typeof Bun.serve>;
	stop(): void;
}

// ── Server factory ──────────────────────────────────────────────

export function createServer(deps: ServerDeps): ServerHandle {
	const { config, repository, claudeService, indexer } = deps;

	const app = new App({ repository, claudeService, config, indexer });
	const websocket = createWsHandlers(app);

	const server = Bun.serve<WsConnectionState>({
		hostname: config.host,
		port: config.port,
		idleTimeout: 120,
		websocket,
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
				return app.listSessions(req);
			}

			if (
				pathname.match(/^\/v1\/sessions\/[^/]+\/history$/) &&
				req.method === "GET"
			) {
				return app.getSessionHistory(req);
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

	log.startup(
		`cc-manager listening on http://${config.host}:${handle.server.port}`,
	);
	log.startup(`claude projects directory: ${config.claudeProjectsDir}`);
	log.startup(`sqlite database: ${config.dbPath}`);
}
