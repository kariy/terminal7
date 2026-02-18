import type { ClaudeServiceLike } from "./claude-service";
import type { ManagerConfig } from "./config";
import type { GitServiceLike } from "./git-service";
import { jsonResponse } from "./http-utils";
import type { ManagerRepository } from "./repository";
import type { IndexerLike } from "./main";
import { toSshConnectionListItem } from "./types";

export class App {
	readonly repository: ManagerRepository;
	readonly claudeService: ClaudeServiceLike;
	readonly config: ManagerConfig;
	readonly indexer?: IndexerLike;
	readonly gitService?: GitServiceLike;

	constructor(deps: {
		repository: ManagerRepository;
		claudeService: ClaudeServiceLike;
		config: ManagerConfig;
		indexer?: IndexerLike;
		gitService?: GitServiceLike;
	}) {
		this.repository = deps.repository;
		this.claudeService = deps.claudeService;
		this.config = deps.config;
		this.indexer = deps.indexer;
		this.gitService = deps.gitService;
	}

	listSessions(req: Request): Response {
		const url = new URL(req.url);
		if (this.indexer && url.searchParams.get("refresh") === "1") {
			this.indexer.refreshIndex();
		}
		const sessions = this.repository.listSessions();
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
				total_cost_usd: session.totalCostUsd,
				repo_id: session.repoId,
				worktree_path: session.worktreePath,
				branch: session.branch,
			})),
		});
	}

	listRepositories(_req: Request): Response {
		const repos = this.repository.listRepositories();
		return jsonResponse(200, {
			repositories: repos.map((r) => ({
				id: r.id,
				url: r.url,
				slug: r.slug,
				default_branch: r.defaultBranch,
				created_at: r.createdAt,
				last_fetched_at: r.lastFetchedAt,
			})),
		});
	}

	getSessionHistory(req: Request): Response {
		const url = new URL(req.url);
		const pathname = url.pathname;

		const match = pathname.match(/^\/v1\/sessions\/([^/]+)\/history$/);
		if (!match?.[1]) {
			return jsonResponse(404, {
				error: { code: "not_found", message: "Not found" },
			});
		}

		const sessionId = decodeURIComponent(match[1]);
		const encodedCwdParam = url.searchParams.get("encoded_cwd");
		const sessionCandidates = this.repository.findSessionCandidates(sessionId);
		const chosen = encodedCwdParam
			? sessionCandidates.find(
					(candidate) => candidate.encodedCwd === encodedCwdParam,
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

		if (!this.indexer) {
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
		const history = this.indexer.readHistory({
			sessionId,
			encodedCwd: chosen.encodedCwd,
			cursor: Number.isNaN(cursor as number) ? undefined : cursor,
		});

		return jsonResponse(200, {
			session_id: sessionId,
			encoded_cwd: chosen.encodedCwd,
			messages: history.messages,
			next_cursor: history.nextCursor,
			total_messages: history.totalMessages,
		});
	}

	// ── SSH Connections ──────────────────────────────────────────

	listSshConnections(): Response {
		const connections = this.repository.listSshConnections();
		return jsonResponse(200, {
			connections: connections.map(toSshConnectionListItem),
		});
	}

	async createSshConnection(req: Request): Promise<Response> {
		let body: { ssh_destination?: string; title?: string };
		try {
			body = await req.json();
		} catch {
			return jsonResponse(400, {
				error: { code: "invalid_json", message: "Invalid JSON body" },
			});
		}

		const sshDestination = body.ssh_destination;
		if (!sshDestination || typeof sshDestination !== "string" || !sshDestination.trim()) {
			return jsonResponse(400, {
				error: {
					code: "invalid_params",
					message: "ssh_destination is required",
				},
			});
		}

		const title = typeof body.title === "string" && body.title.trim()
			? body.title.trim()
			: undefined;

		const connection = this.repository.createSshConnection({
			sshDestination: sshDestination.trim(),
			title,
		});

		return jsonResponse(201, { connection: toSshConnectionListItem(connection) });
	}

	deleteSshConnection(req: Request): Response {
		const url = new URL(req.url);
		const match = url.pathname.match(/^\/v1\/ssh\/connections\/([^/]+)$/);
		if (!match?.[1]) {
			return jsonResponse(404, {
				error: { code: "not_found", message: "Not found" },
			});
		}

		const id = decodeURIComponent(match[1]);
		const deleted = this.repository.deleteSshConnection(id);
		if (!deleted) {
			return jsonResponse(404, {
				error: {
					code: "connection_not_found",
					message: "SSH connection not found",
				},
			});
		}

		return new Response(null, { status: 204 });
	}
}
