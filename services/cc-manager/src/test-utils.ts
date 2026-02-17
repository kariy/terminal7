import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ClaudeServiceLike, StreamPromptArgs } from "./claude-service";
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

// ── Test server lifecycle ───────────────────────────────────────

export interface TestContext {
	baseUrl: string;
	wsUrl: string;
	handle: ServerHandle;
	repository: ManagerRepository;
	claudeService: MockClaudeService;
	config: ManagerConfig;
	tempDir: string;
}

export function createTestServer(overrides?: Partial<ManagerConfig>): TestContext {
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
		...overrides,
	};

	const repository = new ManagerRepository(config.dbPath);
	const claudeService = new MockClaudeService();

	const handle = createServer({ config, repository, claudeService });
	const port = handle.server.port;

	return {
		baseUrl: `http://127.0.0.1:${port}`,
		wsUrl: `ws://127.0.0.1:${port}/v1/ws`,
		handle,
		repository,
		claudeService,
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
