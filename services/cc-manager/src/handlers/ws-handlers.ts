import { isAuthEnabled } from "../auth";
import type { App } from "../app";
import type { ToolPermissionDecision, ToolPermissionRequest } from "../claude-service";
import { repoUrlToSlug } from "../git-service";
import { WsClientMessageSchema, type WsClientMessage } from "../schemas";
import type { WsSessionState } from "../types";
import { encodeCwd, nowMs } from "../utils";
import {
	formatWsLogPayload,
	parseJsonText,
	wsError,
	wsSend,
} from "../ws-utils";
import { log } from "../logger";
import { createPromptHandler } from "./prompt-handler";

const PERMISSION_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingPermissionRequest {
	connectionId: string;
	toolName: string;
	toolInput: Record<string, unknown>;
	signal: AbortSignal;
	abortHandler: () => void;
	timeout: ReturnType<typeof setTimeout>;
	resolve: (decision: ToolPermissionDecision) => void;
}

export function createWsHandlers(app: App) {
	const pendingPermissionRequests = new Map<string, PendingPermissionRequest>();

	function ensureRecord(value: unknown): Record<string, unknown> {
		return typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	}

	function resolvePendingPermissionRequest(
		requestId: string,
		decision: ToolPermissionDecision,
	): boolean {
		const pending = pendingPermissionRequests.get(requestId);
		if (!pending) return false;

		clearTimeout(pending.timeout);
		pending.signal.removeEventListener("abort", pending.abortHandler);
		pendingPermissionRequests.delete(requestId);
		pending.resolve(decision);
		return true;
	}

	async function requestToolPermission(
		ws: Bun.ServerWebSocket<WsSessionState>,
		request: ToolPermissionRequest,
	): Promise<ToolPermissionDecision> {
		return await new Promise<ToolPermissionDecision>((resolve) => {
			const toolInput = ensureRecord(request.toolInput);
			const denyMessage = "Permission request canceled.";
			const abortHandler = () => {
				resolvePendingPermissionRequest(request.permissionRequestId, {
					behavior: "deny",
					message: denyMessage,
				});
			};

			if (request.signal.aborted) {
				resolve({
					behavior: "deny",
					message: denyMessage,
				});
				return;
			}

			const timeout = setTimeout(() => {
				resolvePendingPermissionRequest(request.permissionRequestId, {
					behavior: "deny",
					message: "Permission request timed out.",
				});
			}, PERMISSION_REQUEST_TIMEOUT_MS);

			pendingPermissionRequests.set(request.permissionRequestId, {
				connectionId: ws.data.connectionId,
				toolName: request.toolName,
				toolInput,
				signal: request.signal,
				abortHandler,
				timeout,
				resolve,
			});
			request.signal.addEventListener("abort", abortHandler, { once: true });

			wsSend(ws, {
				type: "permission.request",
				request_id: request.permissionRequestId,
				prompt_request_id: request.promptRequestId,
				tool_name: request.toolName,
				tool_use_id: request.toolUseId,
				tool_input: toolInput,
			});
		});
	}

	const handlePromptMessage = createPromptHandler(app, requestToolPermission);

	type WsHandler = (
		ws: Bun.ServerWebSocket<WsSessionState>,
		message: WsClientMessage,
	) => void;

	async function handleSessionCreate(
		ws: Bun.ServerWebSocket<WsSessionState>,
		message: WsClientMessage,
	) {
		if (message.type !== "session.create") return;
		log.ws("Session created.");

		const requestId = message.request_id ?? crypto.randomUUID();
		let cwd = message.cwd ?? app.config.defaultCwd;
		let repoId: string | undefined;
		let worktreePath: string | undefined;
		let branch: string | undefined;

		// Git worktree setup
		if ((message.repo_url || message.repo_id) && app.gitService) {
			try {
				let repo = message.repo_id
					? app.repository.getRepositoryById(message.repo_id)
					: message.repo_url
						? app.repository.getRepositoryByUrl(message.repo_url)
						: null;

				if (!repo && message.repo_url) {
					const repoInfo = await app.gitService.ensureRepo(
						message.repo_url,
						app.config.projectsDir,
					);
					const slug = repoUrlToSlug(message.repo_url);
					repo = app.repository.insertRepository({
						id: crypto.randomUUID(),
						url: message.repo_url,
						slug,
						bareRepoPath: repoInfo.bareRepoPath,
						defaultBranch: repoInfo.defaultBranch,
					});
				} else if (repo && message.repo_url) {
					// Existing repo by URL — fetch latest
					const repoInfo = await app.gitService.ensureRepo(
						message.repo_url,
						app.config.projectsDir,
					);
					app.repository.updateRepositoryFetched(
						repo.id,
						repoInfo.defaultBranch,
					);
				}

				if (!repo) {
					wsError(
						ws,
						"Repository not found",
						"repo_not_found",
						requestId,
					);
					return;
				}

				repoId = repo.id;
				const worktreeId = crypto.randomUUID();
				const worktreeResult = await app.gitService.createWorktree(
					repo.bareRepoPath,
					{
						branch: message.branch,
						worktreeId,
						projectsDir: app.config.projectsDir,
					},
				);
				await app.gitService.verifyWorktree(
					repo.bareRepoPath,
					worktreeResult.worktreePath,
				);
				worktreePath = worktreeResult.worktreePath;
				branch = worktreeResult.branch;
				cwd = worktreePath;
			} catch (err) {
				wsError(
					ws,
					`Git setup failed: ${err instanceof Error ? err.message : String(err)}`,
					"git_error",
					requestId,
				);
				return;
			}
		}

		const encodedCwd = encodeCwd(cwd);
		app.fileIndexService?.ensureIndex({ encodedCwd, cwd });

		void handlePromptMessage(ws, {
			requestId,
			prompt: message.prompt,
			cwd,
			encodedCwd,
			titleHint: message.title,
			repoId,
			worktreePath,
			branch,
			permissionMode: message.permission_mode,
		});
	}

	function handleSessionResumeOrSend(
		ws: Bun.ServerWebSocket<WsSessionState>,
		message: WsClientMessage,
	) {
		if (
			message.type !== "session.resume" &&
			message.type !== "session.send"
		)
			return;

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

		const metadata = app.repository.getSessionMetadata(
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
		app.fileIndexService?.ensureIndex({
			encodedCwd: message.encoded_cwd,
			cwd,
		});

		void handlePromptMessage(ws, {
			cwd,
			requestId,
			prompt: message.prompt,
			encodedCwd: message.encoded_cwd,
			resumeSessionId: message.session_id,
			permissionMode: message.permission_mode,
		});
	}

	function handleSessionStop(
		ws: Bun.ServerWebSocket<WsSessionState>,
		message: WsClientMessage,
	) {
		if (message.type !== "session.stop") return;

		const stopped = app.claudeService.stopRequest(message.request_id);
		wsSend(ws, {
			type: "session.state",
			request_id: message.request_id,
			status: stopped ? "stopped" : "not_found",
		});
		ws.data.activeRequests.delete(message.request_id);
	}

	function handleRefreshIndex(
		ws: Bun.ServerWebSocket<WsSessionState>,
		_message: WsClientMessage,
	) {
		const stats = app.indexer
			? app.indexer.refreshIndex()
			: { indexed: 0, skippedUnchanged: 0, parseErrors: 0 };
		wsSend(ws, {
			type: "session.state",
			status: "index_refreshed",
			stats,
		});
	}

	function handlePing(
		ws: Bun.ServerWebSocket<WsSessionState>,
		_message: WsClientMessage,
	) {
		wsSend(ws, {
			type: "pong",
			server_time: nowMs(),
		});
	}

	function handleRepoList(
		ws: Bun.ServerWebSocket<WsSessionState>,
		_message: WsClientMessage,
	) {
		const repos = app.repository.listRepositories();
		wsSend(ws, {
			type: "repo.list",
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

	function handleFileSearch(
		ws: Bun.ServerWebSocket<WsSessionState>,
		message: WsClientMessage,
	) {
		if (message.type !== "file.search") return;

		const metadata = app.repository.getSessionMetadata(
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
		const fileIndexService = app.fileIndexService;
		if (!fileIndexService) {
			wsError(
				ws,
				"File index service unavailable",
				"not_implemented",
				message.request_id,
			);
			return;
		}

		fileIndexService.ensureIndex({
			encodedCwd: message.encoded_cwd,
			cwd,
		});

		const result = fileIndexService.search({
			encodedCwd: message.encoded_cwd,
			cwd,
			query: message.query,
			limit: message.limit,
		});

		wsSend(ws, {
			type: "file.search.result",
			request_id: message.request_id,
			session_id: message.session_id,
			encoded_cwd: message.encoded_cwd,
			query: message.query,
			entries: result.entries,
			indexing: result.indexing,
			...(result.truncated ? { truncated: true } : {}),
		});
	}

	function handlePermissionRespond(
		ws: Bun.ServerWebSocket<WsSessionState>,
		message: WsClientMessage,
	) {
		if (message.type !== "permission.respond") return;

		const pending = pendingPermissionRequests.get(message.request_id);
		if (!pending) {
			wsError(
				ws,
				"Permission request not found",
				"permission_request_not_found",
				message.request_id,
			);
			return;
		}
		if (pending.connectionId !== ws.data.connectionId) {
			wsError(
				ws,
				"Permission request does not belong to this connection",
				"permission_request_connection_mismatch",
				message.request_id,
			);
			return;
		}

		const updatedInput =
			message.updated_input ??
			(message.decision === "allow"
				? pending.toolInput
				: undefined);

		resolvePendingPermissionRequest(message.request_id, {
			behavior: message.decision,
			...(message.message && { message: message.message }),
			...(message.mode && { mode: message.mode }),
			...(updatedInput && { updatedInput }),
		});
	}

	const handlers: Record<string, WsHandler> = {
		"session.create": handleSessionCreate,
		"session.resume": handleSessionResumeOrSend,
		"session.send": handleSessionResumeOrSend,
		"session.stop": handleSessionStop,
		"session.refresh_index": handleRefreshIndex,
		ping: handlePing,
		"repo.list": handleRepoList,
		"file.search": handleFileSearch,
		"permission.respond": handlePermissionRespond,
	};

	return {
		open(ws: Bun.ServerWebSocket<WsSessionState>) {
			log.ws(`connected connection_id=${ws.data.connectionId}`);
			wsSend(ws, {
				type: "hello",
				requires_auth: isAuthEnabled(app.config, app.repository),
				server_time: nowMs(),
			});
		},

		async message(
			ws: Bun.ServerWebSocket<WsSessionState>,
			rawMessage: string | Buffer,
		) {
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

		close(ws: Bun.ServerWebSocket<WsSessionState>) {
			for (const requestId of ws.data.activeRequests) {
				app.claudeService.stopRequest(requestId);
			}
			ws.data.activeRequests.clear();

			for (const [requestId, pending] of pendingPermissionRequests.entries()) {
				if (pending.connectionId !== ws.data.connectionId) continue;
				resolvePendingPermissionRequest(requestId, {
					behavior: "deny",
					message: "Permission request canceled: client disconnected.",
				});
			}
		},
		};
	}
