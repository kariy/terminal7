import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { GitService, repoUrlToSlug } from "./git-service";
import {
	createTestServer,
	destroyTestServer,
	WsTestClient,
	type TestContext,
} from "./test-utils";

let ctx: TestContext;
let ws: WsTestClient;

beforeEach(() => {
	ctx = createTestServer({ withGitService: true });
});

afterEach(() => {
	ws?.close();
	destroyTestServer(ctx);
});

async function connect(): Promise<WsTestClient> {
	ws = new WsTestClient(ctx.wsUrl);
	await ws.connected();
	return ws;
}

describe("session.create with repo_url", () => {
	test("calls ensureRepo and createWorktree on gitService", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-git-1",
			prompt: "Hello",
			repo_url: "https://github.com/dojoengine/katana.git",
		});

		await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const git = ctx.gitService!;
		expect(git.ensureRepoCalls).toEqual([
			"https://github.com/dojoengine/katana.git",
		]);
		expect(git.worktreeCalls.length).toBe(1);
		expect(git.verifyWorktreeCalls.length).toBe(1);
		expect(git.worktreeCalls[0]!.projectsDir).toBe(ctx.config.projectsDir);
	});

	test("returns git_error when worktree verification fails", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		const git = ctx.gitService!;
		git.verifyWorktreeError = new Error("worktree verification failed");

		ws.send({
			type: "session.create",
			request_id: "req-git-verify-fail",
			prompt: "Hello",
			repo_url: "https://github.com/dojoengine/katana.git",
		});

		const error = (await ws.nextMessage()) as Record<string, unknown>;
		expect(error.type).toBe("error");
		expect(error.code).toBe("git_error");
		expect(error.request_id).toBe("req-git-verify-fail");
		expect(String(error.message)).toContain(
			"Git setup failed: worktree verification failed",
		);
		expect(ctx.claudeService.calls.length).toBe(0);
	});

	test("session.created uses worktree path as cwd", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-git-cwd",
			prompt: "Hello",
			repo_url: "https://github.com/dojoengine/dojo.git",
		});

		const created = (await ws.nextMessage()) as Record<string, unknown>;
		expect(created.type).toBe("session.created");

		// The cwd should be under worktrees/<uuid>
		const cwd = created.cwd as string;
		expect(cwd).toContain("/worktrees/");
		expect(cwd).toContain(ctx.config.projectsDir);
	});

	test("inserts repository into DB", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-git-db",
			prompt: "Hello",
			repo_url: "https://github.com/cartridge-gg/controller.git",
		});

		await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const repo = ctx.repository.getRepositoryByUrl(
			"https://github.com/cartridge-gg/controller.git",
		);
		expect(repo).not.toBeNull();
		expect(repo!.slug).toBe("github-com-cartridge-gg-controller");
		expect(repo!.defaultBranch).toBe("main");
	});

	test("session metadata includes repo_id, worktree_path, and branch", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-git-meta",
			prompt: "Hello",
			repo_url: "https://github.com/dojoengine/torii.git",
		});

		const messages = await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const created = messages.find(
			(m) => (m as Record<string, unknown>).type === "session.created",
		) as Record<string, unknown>;
		const session = created.session as Record<string, unknown>;
		expect(session.repo_id).toBeDefined();
		expect(typeof session.repo_id).toBe("string");
		expect(session.worktree_path).toBeDefined();
		expect((session.worktree_path as string)).toContain("/worktrees/");
		expect(session.branch).toBe("main");
	});

	test("passes branch option through to createWorktree", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-git-branch",
			prompt: "Hello",
			repo_url: "https://github.com/dojoengine/katana.git",
			branch: "develop",
		});

		await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const git = ctx.gitService!;
		expect(git.worktreeCalls.length).toBe(1);
		expect(git.worktreeCalls[0]!.branch).toBe("develop");
	});

	test("reuses existing repo on second create with same URL", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		// First session
		ws.send({
			type: "session.create",
			request_id: "req-reuse-1",
			prompt: "First",
			repo_url: "https://github.com/dojoengine/dojo.git",
		});
		await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const git = ctx.gitService!;
		expect(git.ensureRepoCalls.length).toBe(1);

		// Second session with same URL
		ws.send({
			type: "session.create",
			request_id: "req-reuse-2",
			prompt: "Second",
			repo_url: "https://github.com/dojoengine/dojo.git",
		});
		await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		// ensureRepo called again (to fetch latest), but only one repo in DB
		expect(git.ensureRepoCalls.length).toBe(2);
		expect(git.worktreeCalls.length).toBe(2);
		const repos = ctx.repository.listRepositories();
		const dojoRepos = repos.filter((r) =>
			r.url === "https://github.com/dojoengine/dojo.git",
		);
		expect(dojoRepos.length).toBe(1);
	});
});

describe("session.create with repo_id", () => {
	test("uses existing repo by ID", async () => {
		// Insert a repo directly
		const repo = ctx.repository.insertRepository({
			id: "repo-123",
			url: "https://github.com/cartridge-gg/controller-rs.git",
			slug: "github-com-cartridge-gg-controller-rs",
			bareRepoPath: "/fake/repos/controller-rs.git",
			defaultBranch: "main",
		});

		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-by-id",
			prompt: "Hello",
			repo_id: "repo-123",
		});

		await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const git = ctx.gitService!;
		// Should NOT call ensureRepo since we're using an existing repo by ID
		expect(git.ensureRepoCalls.length).toBe(0);
		// Should call createWorktree with the bare repo path from the DB
		expect(git.worktreeCalls.length).toBe(1);
	});

	test("returns error for non-existent repo_id", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-bad-id",
			prompt: "Hello",
			repo_id: "nonexistent-repo",
		});

		const error = (await ws.nextMessage()) as Record<string, unknown>;
		expect(error.type).toBe("error");
		expect(error.code).toBe("repo_not_found");
		expect(error.request_id).toBe("req-bad-id");
	});
});

describe("session.create without repo (unchanged behavior)", () => {
	test("works without repo_url or repo_id", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-no-repo",
			prompt: "Hello",
			cwd: "/tmp",
		});

		const messages = await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const created = messages.find(
			(m) => (m as Record<string, unknown>).type === "session.created",
		) as Record<string, unknown>;
		expect(created.cwd).toBe("/tmp");

		const git = ctx.gitService!;
		expect(git.ensureRepoCalls.length).toBe(0);
		expect(git.worktreeCalls.length).toBe(0);
	});
});

describe("GET /v1/repos", () => {
	test("returns empty list when no repos exist", async () => {
		const res = await fetch(`${ctx.baseUrl}/v1/repos`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { repositories: unknown[] };
		expect(body.repositories).toEqual([]);
	});

	test("returns repos after session.create clones one", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-list",
			prompt: "Hello",
			repo_url: "https://github.com/dojoengine/katana.git",
		});
		await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const res = await fetch(`${ctx.baseUrl}/v1/repos`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			repositories: Record<string, unknown>[];
		};
		expect(body.repositories.length).toBe(1);

		const repo = body.repositories[0]!;
		expect(repo.url).toBe("https://github.com/dojoengine/katana.git");
		expect(repo.slug).toBe("github-com-dojoengine-katana");
		expect(repo.default_branch).toBe("main");
		expect(typeof repo.id).toBe("string");
		expect(typeof repo.created_at).toBe("number");
		expect(typeof repo.last_fetched_at).toBe("number");
	});
});

describe("repo.list WS message", () => {
	test("returns repositories via WebSocket", async () => {
		// Insert a repo directly
		ctx.repository.insertRepository({
			id: "ws-repo-1",
			url: "https://github.com/dojoengine/dojo.git",
			slug: "github-com-dojoengine-dojo",
			bareRepoPath: "/fake/repos/dojo.git",
			defaultBranch: "main",
		});

		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({ type: "repo.list" });

		const msg = (await ws.nextMessage()) as Record<string, unknown>;
		expect(msg.type).toBe("repo.list");

		const repos = msg.repositories as Record<string, unknown>[];
		expect(repos.length).toBe(1);
		expect(repos[0]!.id).toBe("ws-repo-1");
		expect(repos[0]!.url).toBe("https://github.com/dojoengine/dojo.git");
		expect(repos[0]!.slug).toBe("github-com-dojoengine-dojo");
		expect(repos[0]!.default_branch).toBe("main");
	});
});

// ── repoUrlToSlug (pure function, no git needed) ────────────────

describe("repoUrlToSlug", () => {
	test("produces correct slugs", () => {
		expect(repoUrlToSlug("https://github.com/dojoengine/katana.git"))
			.toBe("github-com-dojoengine-katana");
		expect(repoUrlToSlug("https://github.com/cartridge-gg/controller-rs.git"))
			.toBe("github-com-cartridge-gg-controller-rs");
		expect(repoUrlToSlug("https://github.com/user/repo"))
			.toBe("github-com-user-repo");
	});
});

// ── Integration tests: real GitService against local repos ──────
//
// These tests require `git` on PATH. They are skipped in sandboxed
// environments where git is unavailable.

function gitAvailable(): boolean {
	try {
		const proc = Bun.spawnSync(["git", "--version"], { stdout: "pipe", stderr: "pipe" });
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

const hasGit = gitAvailable();
const describeGit = hasGit ? describe : describe.skip;

describeGit("GitService integration", () => {
	let tempDir: string;
	let localRepoUrl: string;
	const gitService = new GitService();

	/** Create a real local git repo with a commit so it can be bare-cloned. */
	async function createLocalRepo(): Promise<string> {
		const repoDir = join(tempDir, "origin-repo");
		const run = (args: string[], cwd?: string) =>
			Bun.spawn(["git", ...args], { cwd: cwd ?? repoDir, stdout: "pipe", stderr: "pipe" });

		// Use tempDir as cwd for init since repoDir doesn't exist yet
		await run(["init", repoDir], tempDir).exited;
		await run(["checkout", "-b", "main"]).exited;

		// git needs a user for commit
		await run(["config", "user.email", "test@test.com"]).exited;
		await run(["config", "user.name", "Test"]).exited;

		// Create a file and commit
		await Bun.write(join(repoDir, "README.md"), "# test repo\n");
		await run(["add", "."]).exited;
		await run(["commit", "-m", "initial commit"]).exited;

		return repoDir;
	}

	beforeEach(async () => {
		tempDir = mkdtempSync(join(tmpdir(), "git-svc-test-"));
		localRepoUrl = await createLocalRepo();
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	test("ensureRepo creates a bare clone on disk", async () => {
		const projectsDir = join(tempDir, "projects");

		const info = await gitService.ensureRepo(localRepoUrl, projectsDir);

		// bare clone should exist
		expect(existsSync(info.bareRepoPath)).toBe(true);
		// bare repos have a HEAD file directly in the root
		expect(existsSync(join(info.bareRepoPath, "HEAD"))).toBe(true);
		// should detect default branch
		expect(info.defaultBranch).toBe("main");
	});

	test("ensureRepo is idempotent (fetch on second call)", async () => {
		const projectsDir = join(tempDir, "projects");

		const first = await gitService.ensureRepo(localRepoUrl, projectsDir);
		const second = await gitService.ensureRepo(localRepoUrl, projectsDir);

		expect(first.bareRepoPath).toBe(second.bareRepoPath);
		expect(existsSync(second.bareRepoPath)).toBe(true);
	});

	test("createWorktree creates a working directory with repo files", async () => {
		const projectsDir = join(tempDir, "projects");
		const info = await gitService.ensureRepo(localRepoUrl, projectsDir);

		const worktreeId = "wt-test-001";
		const result = await gitService.createWorktree(info.bareRepoPath, {
			worktreeId,
			projectsDir,
		});

		// Worktree directory should exist
		expect(existsSync(result.worktreePath)).toBe(true);
		// Should contain the committed file
		expect(existsSync(join(result.worktreePath, "README.md"))).toBe(true);
		// Branch should be "main"
		expect(result.branch).toBe("main");
		// Path should be under worktrees/
		expect(result.worktreePath).toBe(join(projectsDir, "worktrees", worktreeId));
	});

	test("verifyWorktree accepts a valid created worktree", async () => {
		const projectsDir = join(tempDir, "projects");
		const info = await gitService.ensureRepo(localRepoUrl, projectsDir);
		const result = await gitService.createWorktree(info.bareRepoPath, {
			worktreeId: "wt-verify-ok",
			projectsDir,
		});

		await gitService.verifyWorktree(info.bareRepoPath, result.worktreePath);
	});

	test("createWorktree with specific branch", async () => {
		const projectsDir = join(tempDir, "projects");
		const info = await gitService.ensureRepo(localRepoUrl, projectsDir);

		// Create a branch in the origin repo first
		await Bun.spawn(["git", "branch", "feature-x"], { cwd: localRepoUrl }).exited;
		// Fetch it into the bare clone
		await Bun.spawn(["git", "fetch", "--all"], { cwd: info.bareRepoPath }).exited;

		const result = await gitService.createWorktree(info.bareRepoPath, {
			worktreeId: "wt-branch-test",
			projectsDir,
			branch: "feature-x",
		});

		expect(result.branch).toBe("feature-x");
		expect(existsSync(result.worktreePath)).toBe(true);
	});

	test("removeWorktree removes the directory", async () => {
		const projectsDir = join(tempDir, "projects");
		const info = await gitService.ensureRepo(localRepoUrl, projectsDir);
		const result = await gitService.createWorktree(info.bareRepoPath, {
			worktreeId: "wt-remove-test",
			projectsDir,
		});

		expect(existsSync(result.worktreePath)).toBe(true);

		await gitService.removeWorktree(info.bareRepoPath, result.worktreePath);

		expect(existsSync(result.worktreePath)).toBe(false);
	});

	test("listBranches returns branches from bare repo", async () => {
		const projectsDir = join(tempDir, "projects");
		const info = await gitService.ensureRepo(localRepoUrl, projectsDir);

		const branches = await gitService.listBranches(info.bareRepoPath);

		expect(branches).toContain("main");
	});

	test("full flow: ensureRepo → createWorktree produces an isolated checkout", async () => {
		const projectsDir = join(tempDir, "projects");

		// Clone
		const info = await gitService.ensureRepo(localRepoUrl, projectsDir);
		expect(existsSync(join(info.bareRepoPath, "HEAD"))).toBe(true);

		// Create two worktrees — each should be independent
		const wt1 = await gitService.createWorktree(info.bareRepoPath, {
			worktreeId: "session-aaa",
			projectsDir,
		});
		const wt2 = await gitService.createWorktree(info.bareRepoPath, {
			worktreeId: "session-bbb",
			projectsDir,
			branch: "main",
		});

		expect(wt1.worktreePath).not.toBe(wt2.worktreePath);
		expect(existsSync(join(wt1.worktreePath, "README.md"))).toBe(true);
		expect(existsSync(join(wt2.worktreePath, "README.md"))).toBe(true);

		// Write a file in wt1 — should NOT appear in wt2
		await Bun.write(join(wt1.worktreePath, "only-in-wt1.txt"), "hello");
		expect(existsSync(join(wt1.worktreePath, "only-in-wt1.txt"))).toBe(true);
		expect(existsSync(join(wt2.worktreePath, "only-in-wt1.txt"))).toBe(false);
	});
});
