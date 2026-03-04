import { realpathSync } from "fs";
import { join, resolve } from "path";

// ── Interfaces ──────────────────────────────────────────────────

export interface RepoInfo {
	bareRepoPath: string;
	defaultBranch: string;
}

export interface CreateWorktreeOpts {
	branch?: string;
	worktreeId: string;
	projectsDir: string;
}

export interface WorktreeResult {
	worktreePath: string;
	branch: string;
}

export interface GitServiceLike {
	ensureRepo(url: string, projectsDir: string): Promise<RepoInfo>;
	createWorktree(
		bareRepoPath: string,
		opts: CreateWorktreeOpts,
	): Promise<WorktreeResult>;
	verifyWorktree(bareRepoPath: string, worktreePath: string): Promise<void>;
	removeWorktree(bareRepoPath: string, worktreePath: string): Promise<void>;
	listBranches(bareRepoPath: string): Promise<string[]>;
	getDefaultBranch(bareRepoPath: string): Promise<string>;
}

// ── Helpers ─────────────────────────────────────────────────────

export function repoUrlToSlug(url: string): string {
	return url
		.replace(/^[a-zA-Z]+:\/\//, "")
		.replace(/\.git$/, "")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
}

async function runGit(
	args: string[],
	cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;

	return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

// ── Implementation ──────────────────────────────────────────────

export class GitService implements GitServiceLike {
	async ensureRepo(url: string, projectsDir: string): Promise<RepoInfo> {
		const slug = repoUrlToSlug(url);
		const bareRepoPath = join(projectsDir, "repos", `${slug}.git`);

		const file = Bun.file(join(bareRepoPath, "HEAD"));
		const exists = await file.exists();

		if (exists) {
			// Fetch latest
			await runGit(["fetch", "--all", "--prune"], bareRepoPath);
		} else {
			const result = await runGit([
				"clone",
				"--bare",
				url,
				bareRepoPath,
			]);
			if (result.exitCode !== 0) {
				throw new Error(`git clone failed: ${result.stderr}`);
			}
			// git clone --bare doesn't set up a fetch refspec, so remote
			// tracking refs (refs/remotes/origin/*) won't be populated by
			// fetch. Configure the refspec and do an initial fetch.
			await runGit(
				["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
				bareRepoPath,
			);
			await runGit(["fetch", "--all", "--prune"], bareRepoPath);
		}

		const defaultBranch = await this.getDefaultBranch(bareRepoPath);
		return { bareRepoPath, defaultBranch };
	}

	async createWorktree(
		bareRepoPath: string,
		opts: CreateWorktreeOpts,
	): Promise<WorktreeResult> {
		const worktreePath = join(
			opts.projectsDir,
			"worktrees",
			opts.worktreeId,
		);
		const branch = opts.branch ?? (await this.getDefaultBranch(bareRepoPath));

		// Create a unique local branch per worktree to avoid
		// "branch already checked out" conflicts when multiple sessions
		// use the same target branch.
		const localBranch = `wt/${opts.worktreeId}`;

		// Try origin/<branch> first (bare clone from remote),
		// fall back to <branch> (local bare clone or local ref).
		let result = await runGit(
			["worktree", "add", "-b", localBranch, worktreePath, `origin/${branch}`],
			bareRepoPath,
		);
		if (result.exitCode !== 0) {
			result = await runGit(
				["worktree", "add", "-b", localBranch, worktreePath, branch],
				bareRepoPath,
			);
		}
		if (result.exitCode !== 0) {
			throw new Error(`git worktree add failed: ${result.stderr}`);
		}

		return { worktreePath, branch };
	}

	async verifyWorktree(
		bareRepoPath: string,
		worktreePath: string,
	): Promise<void> {
		const listResult = await runGit(
			["worktree", "list", "--porcelain"],
			bareRepoPath,
		);
		if (listResult.exitCode !== 0) {
			throw new Error(`git worktree list failed: ${listResult.stderr}`);
		}

		const expectedPath = canonicalPath(worktreePath);
		const registeredPaths = listResult.stdout
			.split("\n")
			.filter((line) => line.startsWith("worktree "))
			.map((line) => canonicalPath(line.slice("worktree ".length).trim()));
		if (!registeredPaths.includes(expectedPath)) {
			throw new Error(`worktree not registered: ${worktreePath}`);
		}

		const inspectResult = await runGit(
			["-C", worktreePath, "rev-parse", "--is-inside-work-tree"],
		);
		if (inspectResult.exitCode !== 0 || inspectResult.stdout !== "true") {
			throw new Error(`worktree is not a valid git checkout: ${worktreePath}`);
		}
	}

	async removeWorktree(
		bareRepoPath: string,
		worktreePath: string,
	): Promise<void> {
		await runGit(
			["worktree", "remove", "--force", worktreePath],
			bareRepoPath,
		);
	}

	async listBranches(bareRepoPath: string): Promise<string[]> {
		const result = await runGit(
			["branch", "--list", "--format=%(refname:short)"],
			bareRepoPath,
		);
		if (result.exitCode !== 0) return [];
		return result.stdout
			.split("\n")
			.map((b) => b.trim())
			.filter(Boolean);
	}

	async getDefaultBranch(bareRepoPath: string): Promise<string> {
		const result = await runGit(
			["symbolic-ref", "refs/remotes/origin/HEAD"],
			bareRepoPath,
		);
		if (result.exitCode === 0 && result.stdout) {
			// refs/remotes/origin/main → main
			return result.stdout.replace("refs/remotes/origin/", "");
		}
		// Fallback: try common names
		const branches = await this.listBranches(bareRepoPath);
		if (branches.includes("main")) return "main";
		if (branches.includes("master")) return "master";
		return branches[0] ?? "main";
	}
}
