import { readdir } from "fs/promises";
import { join } from "path";
import { watch, type Dirent, type FSWatcher } from "fs";
import { log } from "./logger";
import { nowMs } from "./utils";

export interface FileSearchEntry {
	path: string;
	kind: "file" | "dir";
}

export interface FileSearchResult {
	entries: FileSearchEntry[];
	indexing: boolean;
	truncated: boolean;
}

export interface FileIndexServiceLike {
	ensureIndex(params: { encodedCwd: string; cwd: string }): void;
	search(params: {
		encodedCwd: string;
		cwd: string;
		query: string;
		limit?: number;
	}): FileSearchResult;
	dispose(): void;
}

interface IndexedPath extends FileSearchEntry {
	pathLower: string;
	baseLower: string;
}

interface DirectoryIndexState {
	encodedCwd: string;
	cwd: string;
	entries: IndexedPath[];
	indexing: boolean;
	truncated: boolean;
	pendingRebuild: boolean;
	rebuildTimer: ReturnType<typeof setTimeout> | null;
	watcher: FSWatcher | null;
	lastAccessAt: number;
}

const DEFAULT_IGNORED_DIR_NAMES = new Set<string>([
	".git",
	".hg",
	".svn",
	".idea",
	".vscode",
	".next",
	".nuxt",
	".turbo",
	".cache",
	".yarn",
	".pnpm-store",
	".venv",
	"venv",
	"node_modules",
	"target",
	"dist",
	"build",
	"coverage",
]);

function toIndexedPath(path: string, kind: "file" | "dir"): IndexedPath {
	const pathLower = path.toLowerCase();
	const slashIndex = pathLower.lastIndexOf("/");
	const baseLower = slashIndex >= 0
		? pathLower.slice(slashIndex + 1)
		: pathLower;
	return {
		path,
		kind,
		pathLower,
		baseLower,
	};
}

function compareIndexedPaths(a: IndexedPath, b: IndexedPath): number {
	if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
	return a.path.localeCompare(b.path);
}

export class FileIndexService implements FileIndexServiceLike {
	private readonly indexes = new Map<string, DirectoryIndexState>();
	private readonly ignoredDirNames: Set<string>;
	private readonly maxEntries: number;
	private readonly rebuildDebounceMs: number;
	private readonly idleTtlMs: number;
	private readonly cleanupTimer: ReturnType<typeof setInterval>;

	constructor(params?: {
		ignoredDirNames?: Iterable<string>;
		maxEntries?: number;
		rebuildDebounceMs?: number;
		idleTtlMs?: number;
		cleanupIntervalMs?: number;
	}) {
		this.ignoredDirNames = new Set(
			params?.ignoredDirNames ?? DEFAULT_IGNORED_DIR_NAMES,
		);
		this.maxEntries = params?.maxEntries ?? 200_000;
		this.rebuildDebounceMs = params?.rebuildDebounceMs ?? 400;
		this.idleTtlMs = params?.idleTtlMs ?? 15 * 60_000;
		const cleanupIntervalMs = params?.cleanupIntervalMs ?? 60_000;

		this.cleanupTimer = setInterval(() => {
			this.cleanupIdleIndexes();
		}, cleanupIntervalMs);
		this.cleanupTimer.unref?.();
	}

	ensureIndex(params: { encodedCwd: string; cwd: string }): void {
		const state = this.getOrCreateState(params.encodedCwd, params.cwd);
		state.lastAccessAt = nowMs();

		this.ensureWatcher(state);

		if (!state.indexing && state.entries.length === 0 && !state.rebuildTimer) {
			this.scheduleRebuild(state, "initial", 0);
		}
	}

	search(params: {
		encodedCwd: string;
		cwd: string;
		query: string;
		limit?: number;
	}): FileSearchResult {
		const state = this.getOrCreateState(params.encodedCwd, params.cwd);
		state.lastAccessAt = nowMs();
		this.ensureWatcher(state);

		if (!state.indexing && state.entries.length === 0 && !state.rebuildTimer) {
			this.scheduleRebuild(state, "search_miss", 0);
		}

		const limit = Math.max(1, Math.min(params.limit ?? 20, 50));
		const query = params.query.trim().toLowerCase();

		if (query.length === 0) {
			return {
				entries: state.entries.slice(0, limit).map(({ path, kind }) => ({
					path,
					kind,
				})),
				indexing: state.indexing || state.rebuildTimer !== null,
				truncated: state.truncated,
			};
		}

		const prefixMatches: IndexedPath[] = [];
		const segmentMatches: IndexedPath[] = [];
		const substringMatches: IndexedPath[] = [];

		for (const entry of state.entries) {
			const index = entry.pathLower.indexOf(query);
			if (index < 0) continue;

			if (index === 0) {
				prefixMatches.push(entry);
				// Path-start matches are the highest tier and entries are already sorted.
				if (prefixMatches.length >= limit) break;
				continue;
			}

			if (
				entry.baseLower.startsWith(query) ||
				entry.pathLower.includes(`/${query}`)
			) {
				segmentMatches.push(entry);
				continue;
			}

			substringMatches.push(entry);
		}

		const merged = [...prefixMatches, ...segmentMatches, ...substringMatches]
			.slice(0, limit)
			.map(({ path, kind }) => ({ path, kind }));

		return {
			entries: merged,
			indexing: state.indexing || state.rebuildTimer !== null,
			truncated: state.truncated,
		};
	}

	dispose(): void {
		clearInterval(this.cleanupTimer);
		for (const state of this.indexes.values()) {
			this.teardownState(state);
		}
		this.indexes.clear();
	}

	private getOrCreateState(
		encodedCwd: string,
		cwd: string,
	): DirectoryIndexState {
		const existing = this.indexes.get(encodedCwd);
		if (!existing) {
			const created: DirectoryIndexState = {
				encodedCwd,
				cwd,
				entries: [],
				indexing: false,
				truncated: false,
				pendingRebuild: false,
				rebuildTimer: null,
				watcher: null,
				lastAccessAt: nowMs(),
			};
			this.indexes.set(encodedCwd, created);
			return created;
		}

		if (existing.cwd !== cwd) {
			this.teardownState(existing);
			existing.cwd = cwd;
			existing.entries = [];
			existing.truncated = false;
			existing.pendingRebuild = false;
		}

		return existing;
	}

	private ensureWatcher(state: DirectoryIndexState): void {
		if (state.watcher) return;

		const onChange = (_event: string, filename: string | Buffer | null) => {
			if (typeof filename === "string") {
				const segments = filename.split(/[\\/]/g);
				if (segments.some((segment) => this.ignoredDirNames.has(segment))) {
					return;
				}
			}
			this.scheduleRebuild(state, "watch_change", this.rebuildDebounceMs);
		};

		try {
			state.watcher = watch(state.cwd, { recursive: true }, onChange);
			return;
		} catch {
			// Linux does not support recursive watch; fall back to root-only watch.
		}

		try {
			state.watcher = watch(state.cwd, onChange);
		} catch (err) {
			log.index(
				`file-index watch_disabled encoded_cwd=${state.encodedCwd} cwd=${state.cwd} error=${err instanceof Error ? err.message : String(err)}`,
			);
			state.watcher = null;
		}
	}

	private scheduleRebuild(
		state: DirectoryIndexState,
		reason: string,
		delayMs: number,
	): void {
		if (state.rebuildTimer) {
			clearTimeout(state.rebuildTimer);
		}

		state.rebuildTimer = setTimeout(() => {
			state.rebuildTimer = null;
			void this.rebuildIndex(state, reason);
		}, delayMs);
	}

	private async rebuildIndex(
		state: DirectoryIndexState,
		reason: string,
	): Promise<void> {
		if (state.indexing) {
			state.pendingRebuild = true;
			return;
		}

		state.indexing = true;
		const startedAt = nowMs();
		log.index(
			`file-index rebuilding encoded_cwd=${state.encodedCwd} cwd=${state.cwd} reason=${reason}`,
		);

		try {
			const result = await this.scanDirectoryTree(state.cwd);
			state.entries = result.entries;
			state.truncated = result.truncated;
			const elapsedMs = nowMs() - startedAt;
			log.index(
				`file-index rebuilt encoded_cwd=${state.encodedCwd} entries=${result.entries.length} truncated=${result.truncated} reason=${reason} duration_ms=${elapsedMs}`,
			);
		} catch (err) {
			log.index(
				`file-index rebuild_error encoded_cwd=${state.encodedCwd} cwd=${state.cwd} reason=${reason} error=${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			state.indexing = false;
			if (state.pendingRebuild) {
				state.pendingRebuild = false;
				this.scheduleRebuild(state, "pending", 0);
			}
		}
	}

	private async scanDirectoryTree(cwd: string): Promise<{
		entries: IndexedPath[];
		truncated: boolean;
	}> {
		try {
			return await this.scanWithRipgrep(cwd);
		} catch (err) {
			log.index(
				`file-index ripgrep_fallback cwd=${cwd} error=${err instanceof Error ? err.message : String(err)}`,
			);
			return this.scanWithFilesystem(cwd);
		}
	}

	private async scanWithRipgrep(cwd: string): Promise<{
		entries: IndexedPath[];
		truncated: boolean;
	}> {
		const cmd: string[] = [
			"rg",
			"--files",
			"--hidden",
			"--no-ignore",
			"--no-config",
			"--path-separator",
			"/",
			"--sort",
			"path",
			"--color",
			"never",
		];

		// Prefer explicit high-cost directory skips regardless of .gitignore.
		for (const dirName of this.ignoredDirNames) {
			cmd.push("--glob", `!${dirName}/**`);
		}

		const proc = Bun.spawn(cmd, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdoutText, stderrText, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		// rg returns 1 when no files are matched.
		if (exitCode !== 0 && exitCode !== 1) {
			throw new Error(
				`rg exited with code ${exitCode}${stderrText ? `: ${stderrText.trim()}` : ""}`,
			);
		}

		const rawPaths = stdoutText
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);

		const fileSet = new Set<string>();
		const dirSet = new Set<string>();

		for (const rawPath of rawPaths) {
			const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
			if (!normalized) continue;
			if (this.hasIgnoredSegment(normalized)) continue;

			fileSet.add(normalized);

			let slashIndex = normalized.lastIndexOf("/");
			while (slashIndex > 0) {
				const dirPath = normalized.slice(0, slashIndex);
				if (!this.hasIgnoredSegment(dirPath)) {
					dirSet.add(dirPath);
				}
				slashIndex = dirPath.lastIndexOf("/");
			}
		}

		const allEntries: IndexedPath[] = [
			...Array.from(dirSet, (path) => toIndexedPath(path, "dir")),
			...Array.from(fileSet, (path) => toIndexedPath(path, "file")),
		];
		allEntries.sort(compareIndexedPaths);

		const truncated = allEntries.length > this.maxEntries;
		return {
			entries: truncated ? allEntries.slice(0, this.maxEntries) : allEntries,
			truncated,
		};
	}

	private async scanWithFilesystem(cwd: string): Promise<{
		entries: IndexedPath[];
		truncated: boolean;
	}> {
		const entries: IndexedPath[] = [];
		let truncated = false;
		const stack: Array<{ absolute: string; relative: string }> = [
			{ absolute: cwd, relative: "" },
		];

		while (stack.length > 0 && !truncated) {
			const current = stack.pop();
			if (!current) break;

			let children: Dirent[];
			try {
				children = await readdir(current.absolute, { withFileTypes: true });
			} catch {
				continue;
			}

			children.sort((a, b) => a.name.localeCompare(b.name));

			for (const child of children) {
				if (child.isSymbolicLink()) continue;
				if (child.name === "." || child.name === "..") continue;

				if (child.isDirectory() && this.ignoredDirNames.has(child.name)) {
					continue;
				}

				const relativePath = current.relative
					? `${current.relative}/${child.name}`
					: child.name;

				if (child.isDirectory()) {
					entries.push(toIndexedPath(relativePath, "dir"));
					if (entries.length >= this.maxEntries) {
						truncated = true;
						break;
					}
					stack.push({
						absolute: join(current.absolute, child.name),
						relative: relativePath,
					});
					continue;
				}

				if (child.isFile()) {
					entries.push(toIndexedPath(relativePath, "file"));
					if (entries.length >= this.maxEntries) {
						truncated = true;
						break;
					}
				}
			}
		}

		entries.sort(compareIndexedPaths);

		return { entries, truncated };
	}

	private hasIgnoredSegment(path: string): boolean {
		return path
			.split("/")
			.some((segment) => this.ignoredDirNames.has(segment));
	}

	private cleanupIdleIndexes(): void {
		const cutoff = nowMs() - this.idleTtlMs;
		for (const [encodedCwd, state] of this.indexes) {
			if (state.lastAccessAt >= cutoff) continue;
			if (state.indexing) continue;
			this.teardownState(state);
			this.indexes.delete(encodedCwd);
			log.index(`file-index evicted encoded_cwd=${encodedCwd}`);
		}
	}

	private teardownState(state: DirectoryIndexState): void {
		if (state.rebuildTimer) {
			clearTimeout(state.rebuildTimer);
			state.rebuildTimer = null;
		}
		state.watcher?.close();
		state.watcher = null;
		state.pendingRebuild = false;
	}
}
