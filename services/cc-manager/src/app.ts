import type { ClaudeServiceLike } from "./claude-service";
import type { ManagerConfig } from "./config";
import { jsonResponse } from "./http-utils";
import type { ManagerRepository } from "./repository";
import type { IndexerLike } from "./main";

export class App {
	readonly repository: ManagerRepository;
	readonly claudeService: ClaudeServiceLike;
	readonly config: ManagerConfig;
	readonly indexer?: IndexerLike;

	constructor(deps: {
		repository: ManagerRepository;
		claudeService: ClaudeServiceLike;
		config: ManagerConfig;
		indexer?: IndexerLike;
	}) {
		this.repository = deps.repository;
		this.claudeService = deps.claudeService;
		this.config = deps.config;
		this.indexer = deps.indexer;
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
}
