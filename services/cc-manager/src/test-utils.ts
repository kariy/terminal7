import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ClaudeServiceLike, StreamPromptArgs } from "./claude-service";
import type { FileIndexServiceLike, FileSearchEntry } from "./file-index-service";
import type {
	GitServiceLike,
	RepoInfo,
	CreateWorktreeOpts,
	WorktreeResult,
} from "./git-service";
import type { TerminalServiceLike, TerminalOpenParams, TerminalHandle } from "./terminal-service";
import { ManagerRepository } from "./repository";
import { createServer, type ServerHandle } from "./main";
import type { ManagerConfig } from "./config";

// ── MockClaudeService ───────────────────────────────────────────

type StreamBehavior = (args: StreamPromptArgs) => Promise<void>;

export class MockClaudeService implements ClaudeServiceLike {
	calls: StreamPromptArgs[] = [];
	stopCalls: string[] = [];
	private behavior: StreamBehavior = async (args) => {
		args.onSessionId("mock-session-id");
		args.onMessage({
			type: "stream_event",
			event: {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "mock response" },
			},
		} as any);
		args.onDone();
	};

	setBehavior(fn: StreamBehavior): void {
		this.behavior = fn;
	}

	async streamPrompt(args: StreamPromptArgs): Promise<void> {
		this.calls.push(args);
		await this.behavior(args);
	}

	stopRequest(requestId: string): boolean {
		this.stopCalls.push(requestId);
		return false;
	}
}

// ── MockTerminalService ─────────────────────────────────────────

export interface MockTerminalHandle extends TerminalHandle {
	written: Buffer[];
	resizes: Array<{ cols: number; rows: number }>;
	closed: boolean;
	simulateOutput(data: string | Buffer): void;
	simulateExit(code: number): void;
}

export class MockTerminalService implements TerminalServiceLike {
	openCalls: TerminalOpenParams[] = [];
	private lastHandle: MockTerminalHandle | null = null;

	open(params: TerminalOpenParams): MockTerminalHandle {
		this.openCalls.push(params);

		const handle: MockTerminalHandle = {
			written: [],
			resizes: [],
			closed: false,
			write(data: Buffer | string) {
				handle.written.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
			},
			resize(cols: number, rows: number) {
				handle.resizes.push({ cols, rows });
			},
			close() {
				handle.closed = true;
			},
			simulateOutput(data: string | Buffer) {
				params.onData(Buffer.isBuffer(data) ? data : Buffer.from(data));
			},
			simulateExit(code: number) {
				params.onExit(code);
			},
		};

		this.lastHandle = handle;
		return handle;
	}

	getLastHandle(): MockTerminalHandle | null {
		return this.lastHandle;
	}
}

// ── MockGitService ──────────────────────────────────────────────

export class MockGitService implements GitServiceLike {
	ensureRepoCalls: string[] = [];
	worktreeCalls: CreateWorktreeOpts[] = [];
	removeWorktreeCalls: string[] = [];

	async ensureRepo(url: string, projectsDir: string): Promise<RepoInfo> {
		this.ensureRepoCalls.push(url);
		return {
			bareRepoPath: join(projectsDir, "repos", "mock.git"),
			defaultBranch: "main",
		};
	}

	async createWorktree(
		_bareRepoPath: string,
		opts: CreateWorktreeOpts,
	): Promise<WorktreeResult> {
		this.worktreeCalls.push(opts);
		return {
			worktreePath: join(opts.projectsDir, "worktrees", opts.worktreeId),
			branch: opts.branch ?? "main",
		};
	}

	async removeWorktree(
		_bareRepoPath: string,
		worktreePath: string,
	): Promise<void> {
		this.removeWorktreeCalls.push(worktreePath);
	}

	async listBranches(_bareRepoPath: string): Promise<string[]> {
		return ["main", "develop"];
	}

	async getDefaultBranch(_bareRepoPath: string): Promise<string> {
		return "main";
	}
}

// ── MockFileIndexService ────────────────────────────────────────

export class MockFileIndexService implements FileIndexServiceLike {
	ensureCalls: Array<{ encodedCwd: string; cwd: string }> = [];
	searchCalls: Array<{
		encodedCwd: string;
		cwd: string;
		query: string;
		limit?: number;
	}> = [];
	disposed = false;

	private readonly entriesByCwd = new Map<string, FileSearchEntry[]>();
	private readonly indexingByCwd = new Map<string, boolean>();
	private readonly truncatedByCwd = new Map<string, boolean>();

	setEntries(encodedCwd: string, entries: FileSearchEntry[]): void {
		this.entriesByCwd.set(encodedCwd, entries);
	}

	setIndexing(encodedCwd: string, indexing: boolean): void {
		this.indexingByCwd.set(encodedCwd, indexing);
	}

	setTruncated(encodedCwd: string, truncated: boolean): void {
		this.truncatedByCwd.set(encodedCwd, truncated);
	}

	ensureIndex(params: { encodedCwd: string; cwd: string }): void {
		this.ensureCalls.push(params);
	}

	search(params: {
		encodedCwd: string;
		cwd: string;
		query: string;
		limit?: number;
	}) {
		this.searchCalls.push(params);
		const allEntries = this.entriesByCwd.get(params.encodedCwd) ?? [];
		const query = params.query.trim().toLowerCase();
		const limit = params.limit ?? 20;
		const filtered = query.length === 0
			? allEntries
			: allEntries.filter((entry) =>
					entry.path.toLowerCase().includes(query),
				);

		return {
			entries: filtered.slice(0, limit),
			indexing: this.indexingByCwd.get(params.encodedCwd) ?? false,
			truncated: this.truncatedByCwd.get(params.encodedCwd) ?? false,
		};
	}

	dispose(): void {
		this.disposed = true;
	}
}

// ── Test server lifecycle ───────────────────────────────────────

export interface TestContext {
	baseUrl: string;
	wsUrl: string;
	handle: ServerHandle;
	repository: ManagerRepository;
	claudeService: MockClaudeService;
	terminalService?: MockTerminalService;
	gitService?: MockGitService;
	fileIndexService: MockFileIndexService;
	config: ManagerConfig;
	tempDir: string;
}

export interface CreateTestServerOptions {
	configOverrides?: Partial<ManagerConfig>;
	withTerminalService?: boolean;
	withGitService?: boolean;
}

export function createTestServer(overridesOrOpts?: Partial<ManagerConfig> | CreateTestServerOptions): TestContext {
	const isOpts = overridesOrOpts && ("configOverrides" in overridesOrOpts || "withTerminalService" in overridesOrOpts || "withGitService" in overridesOrOpts);
	const opts = isOpts ? (overridesOrOpts as CreateTestServerOptions) : undefined;
	const overrides = isOpts ? opts?.configOverrides : overridesOrOpts as Partial<ManagerConfig> | undefined;

	const tempDir = mkdtempSync(join(tmpdir(), "cc-manager-test-"));
	const dbPath = join(tempDir, "test.db");

	const config: ManagerConfig = {
		host: "127.0.0.1",
		port: 0,
		dbPath,
		claudeProjectsDir: join(tempDir, "projects"),
		allowedTools: ["Read", "Glob", "Grep", "Bash"],
		maxHistoryMessages: 5000,
		defaultCwd: "/",
		projectsDir: join(tempDir, "git-projects"),
		...overrides,
	};

	const repository = new ManagerRepository(config.dbPath);
	const claudeService = new MockClaudeService();
	const terminalService = opts?.withTerminalService ? new MockTerminalService() : undefined;
	const gitService = opts?.withGitService ? new MockGitService() : undefined;
	const fileIndexService = new MockFileIndexService();

	const handle = createServer({
		config,
		repository,
		claudeService,
		terminalService,
		gitService,
		fileIndexService,
	});
	const port = handle.server.port;

	return {
		baseUrl: `http://127.0.0.1:${port}`,
		wsUrl: `ws://127.0.0.1:${port}/v1/ws`,
		handle,
		repository,
		claudeService,
		terminalService,
		gitService,
		fileIndexService,
		config,
		tempDir,
	};
}

export function destroyTestServer(ctx: TestContext): void {
	ctx.handle.stop();
	rmSync(ctx.tempDir, { recursive: true, force: true });
}

// ── WsTestClient ────────────────────────────────────────────────

export class WsTestClient {
	private ws: WebSocket;
	private messageQueue: unknown[] = [];
	private waiters: Array<(msg: unknown) => void> = [];
	private openResolve!: () => void;
	private openPromise: Promise<void>;

	constructor(url: string) {
		this.openPromise = new Promise<void>((resolve) => {
			this.openResolve = resolve;
		});

		this.ws = new WebSocket(url);

		this.ws.addEventListener("open", () => {
			this.openResolve();
		});

		this.ws.addEventListener("message", (event) => {
			const data = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
			if (this.waiters.length > 0) {
				const waiter = this.waiters.shift()!;
				waiter(data);
			} else {
				this.messageQueue.push(data);
			}
		});
	}

	connected(): Promise<void> {
		return this.openPromise;
	}

	nextMessage(timeoutMs = 2000): Promise<unknown> {
		if (this.messageQueue.length > 0) {
			return Promise.resolve(this.messageQueue.shift()!);
		}

		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.waiters.indexOf(handler);
				if (idx >= 0) this.waiters.splice(idx, 1);
				reject(new Error(`WsTestClient: no message within ${timeoutMs}ms`));
			}, timeoutMs);

			const handler = (msg: unknown) => {
				clearTimeout(timer);
				resolve(msg);
			};

			this.waiters.push(handler);
		});
	}

	async collectUntil(
		predicate: (msg: unknown) => boolean,
		timeoutMs = 5000,
	): Promise<unknown[]> {
		const collected: unknown[] = [];
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) break;
			try {
				const msg = await this.nextMessage(remaining);
				collected.push(msg);
				if (predicate(msg)) return collected;
			} catch {
				break;
			}
		}

		throw new Error(
			`WsTestClient: predicate not matched within ${timeoutMs}ms (collected ${collected.length} messages)`,
		);
	}

	send(payload: unknown): void {
		this.ws.send(JSON.stringify(payload));
	}

	close(): void {
		this.ws.close();
	}
}

// ── RawWsTestClient (for terminal tests — raw binary/text) ──────

export class RawWsTestClient {
	private ws: WebSocket;
	private messageQueue: (string | ArrayBuffer)[] = [];
	private waiters: Array<(msg: string | ArrayBuffer) => void> = [];
	private openResolve!: () => void;
	private closeResolve!: (ev: CloseEvent) => void;
	private openPromise: Promise<void>;
	readonly closePromise: Promise<CloseEvent>;

	constructor(url: string) {
		this.openPromise = new Promise<void>((resolve) => {
			this.openResolve = resolve;
		});
		this.closePromise = new Promise<CloseEvent>((resolve) => {
			this.closeResolve = resolve;
		});

		this.ws = new WebSocket(url);
		this.ws.binaryType = "arraybuffer";

		this.ws.addEventListener("open", () => {
			this.openResolve();
		});

		this.ws.addEventListener("message", (event) => {
			const data = event.data as string | ArrayBuffer;
			if (this.waiters.length > 0) {
				const waiter = this.waiters.shift()!;
				waiter(data);
			} else {
				this.messageQueue.push(data);
			}
		});

		this.ws.addEventListener("close", (ev) => {
			this.closeResolve(ev);
			// Flush any pending waiters
			for (const waiter of this.waiters) {
				waiter("");
			}
			this.waiters.length = 0;
		});
	}

	connected(): Promise<void> {
		return this.openPromise;
	}

	nextMessage(timeoutMs = 2000): Promise<string | ArrayBuffer> {
		if (this.messageQueue.length > 0) {
			return Promise.resolve(this.messageQueue.shift()!);
		}

		return new Promise<string | ArrayBuffer>((resolve, reject) => {
			const timer = setTimeout(() => {
				const idx = this.waiters.indexOf(handler);
				if (idx >= 0) this.waiters.splice(idx, 1);
				reject(new Error(`RawWsTestClient: no message within ${timeoutMs}ms`));
			}, timeoutMs);

			const handler = (msg: string | ArrayBuffer) => {
				clearTimeout(timer);
				resolve(msg);
			};

			this.waiters.push(handler);
		});
	}

	send(data: string): void {
		this.ws.send(data);
	}

	sendBinary(data: Uint8Array): void {
		this.ws.send(data);
	}

	close(): void {
		this.ws.close();
	}
}
