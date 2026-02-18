import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type {
	JsonlIndexUpdate,
	RepositoryInfo,
	SessionMetadata,
	SessionSummary,
	SshConnection,
} from "./types";
import { nowMs } from "./utils";

interface SessionMetadataRow {
	session_id: string;
	encoded_cwd: string;
	cwd: string;
	title: string;
	created_at: number;
	updated_at: number;
	last_activity_at: number;
	source: "db" | "jsonl" | "merged";
	total_cost_usd: number;
	repo_id: string | null;
	worktree_path: string | null;
	branch: string | null;
}

interface RepositoryRow {
	id: string;
	url: string;
	slug: string;
	bare_repo_path: string;
	default_branch: string;
	created_at: number;
	last_fetched_at: number;
}

interface SessionSummaryRow extends SessionMetadataRow {
	message_count: number;
}

interface SshConnectionRow {
	id: string;
	ssh_destination: string;
	tmux_session_name: string;
	title: string;
	created_at: number;
	last_connected_at: number;
}

interface FileIndexRow {
	session_id: string;
	encoded_cwd: string;
	jsonl_path: string;
	file_mtime_ms: number;
	file_size: number;
	message_count: number;
	first_user_text: string | null;
	last_assistant_text: string | null;
	last_indexed_at: number;
}

export class ManagerRepository {
	private readonly db: Database;

	constructor(dbPath: string) {
		mkdirSync(dirname(dbPath), { recursive: true });
		this.db = new Database(dbPath, { create: true, strict: true });
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec("PRAGMA busy_timeout = 5000;");
		this.db.exec("PRAGMA foreign_keys = ON;");
		this.applyMigrations();
	}

	private applyMigrations(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				version INTEGER PRIMARY KEY,
				applied_at INTEGER NOT NULL
			);
		`);

		const hasV1 = this.db
			.query("SELECT 1 FROM schema_migrations WHERE version = 1")
			.get() as { "1": number } | null;
		if (!hasV1) {
			this.db.transaction(() => {
				this.db.exec(`
					CREATE TABLE IF NOT EXISTS session_metadata (
						session_id TEXT NOT NULL,
						encoded_cwd TEXT NOT NULL,
						cwd TEXT NOT NULL,
						title TEXT NOT NULL,
						created_at INTEGER NOT NULL,
						updated_at INTEGER NOT NULL,
						last_activity_at INTEGER NOT NULL,
						source TEXT NOT NULL,
						total_cost_usd REAL NOT NULL DEFAULT 0,
						PRIMARY KEY (session_id, encoded_cwd)
					);
				`);

				this.db.exec(`
					CREATE TABLE IF NOT EXISTS session_events (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						session_id TEXT NOT NULL,
						encoded_cwd TEXT NOT NULL,
						event_type TEXT NOT NULL,
						payload_json TEXT,
						created_at INTEGER NOT NULL
					);
				`);

				this.db.exec(`
					CREATE TABLE IF NOT EXISTS session_file_index (
						session_id TEXT NOT NULL,
						encoded_cwd TEXT NOT NULL,
						jsonl_path TEXT NOT NULL,
						file_mtime_ms INTEGER NOT NULL,
						file_size INTEGER NOT NULL,
						message_count INTEGER NOT NULL,
						first_user_text TEXT,
						last_assistant_text TEXT,
						last_indexed_at INTEGER NOT NULL,
						PRIMARY KEY (session_id, encoded_cwd)
					);
				`);

				this.db.exec(
					"CREATE INDEX IF NOT EXISTS idx_session_metadata_activity ON session_metadata(last_activity_at DESC);",
				);
				this.db.exec(
					"CREATE INDEX IF NOT EXISTS idx_session_events_lookup ON session_events(session_id, encoded_cwd, created_at DESC);",
				);

				this.db
					.query(
						"INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)",
					)
					.run(nowMs());
			})();
		}

		// V2: Add total_cost_usd column to session_metadata
		const hasV2 = this.db
			.query("SELECT 1 FROM schema_migrations WHERE version = 2")
			.get() as { "1": number } | null;
		if (!hasV2) {
			this.db.transaction(() => {
				// Column may already exist if V1 was applied fresh with V2 schema
				const cols = this.db
					.query("PRAGMA table_info(session_metadata)")
					.all() as { name: string }[];
				if (!cols.some((c) => c.name === "total_cost_usd")) {
					this.db.exec(
						"ALTER TABLE session_metadata ADD COLUMN total_cost_usd REAL NOT NULL DEFAULT 0;",
					);
				}
				this.db
					.query(
						"INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)",
					)
					.run(nowMs());
			})();
		}

		// V3: Add repositories table + repo columns on session_metadata
		const hasV3 = this.db
			.query("SELECT 1 FROM schema_migrations WHERE version = 3")
			.get() as { "1": number } | null;
		if (!hasV3) {
			this.db.transaction(() => {
				this.db.exec(`
					CREATE TABLE IF NOT EXISTS repositories (
						id TEXT PRIMARY KEY,
						url TEXT NOT NULL UNIQUE,
						slug TEXT NOT NULL,
						bare_repo_path TEXT NOT NULL,
						default_branch TEXT NOT NULL DEFAULT 'main',
						created_at INTEGER NOT NULL,
						last_fetched_at INTEGER NOT NULL
					);
				`);
				this.db.exec(
					"CREATE INDEX IF NOT EXISTS idx_repositories_url ON repositories(url);",
				);

				const cols = this.db
					.query("PRAGMA table_info(session_metadata)")
					.all() as { name: string }[];
				if (!cols.some((c) => c.name === "repo_id")) {
					this.db.exec(
						"ALTER TABLE session_metadata ADD COLUMN repo_id TEXT;",
					);
				}
				if (!cols.some((c) => c.name === "worktree_path")) {
					this.db.exec(
						"ALTER TABLE session_metadata ADD COLUMN worktree_path TEXT;",
					);
				}
				if (!cols.some((c) => c.name === "branch")) {
					this.db.exec(
						"ALTER TABLE session_metadata ADD COLUMN branch TEXT;",
					);
				}

				this.db
					.query(
						"INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)",
					)
					.run(nowMs());
			})();
		}

		// V4: Add ssh_connections table
		const hasV4 = this.db
			.query("SELECT 1 FROM schema_migrations WHERE version = 4")
			.get() as { "1": number } | null;
		if (!hasV4) {
			this.db.transaction(() => {
				this.db.exec(`
					CREATE TABLE IF NOT EXISTS ssh_connections (
						id TEXT PRIMARY KEY,
						ssh_destination TEXT NOT NULL,
						tmux_session_name TEXT NOT NULL UNIQUE,
						title TEXT NOT NULL,
						created_at INTEGER NOT NULL,
						last_connected_at INTEGER NOT NULL
					);
				`);
				this.db.exec(
					"CREATE INDEX IF NOT EXISTS idx_ssh_connections_last_connected ON ssh_connections(last_connected_at DESC);",
				);

				this.db
					.query(
						"INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?)",
					)
					.run(nowMs());
			})();
		}
	}

	private getMetadataRow(
		sessionId: string,
		encodedCwd: string,
	): SessionMetadataRow | null {
		return this.db
			.query(
				"SELECT * FROM session_metadata WHERE session_id = ? AND encoded_cwd = ?",
			)
			.get(sessionId, encodedCwd) as SessionMetadataRow | null;
	}

	upsertSessionMetadata(params: {
		sessionId: string;
		encodedCwd: string;
		cwd: string;
		title: string;
		lastActivityAt?: number;
		source: "db" | "jsonl";
		costToAdd?: number;
		repoId?: string;
		worktreePath?: string;
		branch?: string;
	}): SessionMetadata {
		const ts = nowMs();
		const activity = params.lastActivityAt ?? ts;
		const existing = this.getMetadataRow(
			params.sessionId,
			params.encodedCwd,
		);
		const source: SessionMetadata["source"] = existing
			? existing.source === params.source
				? params.source
				: "merged"
			: params.source;
		const createdAt = existing?.created_at ?? ts;
		const totalCostUsd =
			(existing?.total_cost_usd ?? 0) + (params.costToAdd ?? 0);
		const repoId = params.repoId ?? existing?.repo_id ?? undefined;
		const worktreePath = params.worktreePath ?? existing?.worktree_path ?? undefined;
		const branch = params.branch ?? existing?.branch ?? undefined;

		this.db
			.query(
				`INSERT OR REPLACE INTO session_metadata (
					session_id, encoded_cwd, cwd, title, created_at, updated_at, last_activity_at, source, total_cost_usd, repo_id, worktree_path, branch
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				params.sessionId,
				params.encodedCwd,
				params.cwd,
				params.title,
				createdAt,
				ts,
				activity,
				source,
				totalCostUsd,
				repoId ?? null,
				worktreePath ?? null,
				branch ?? null,
			);

		return {
			sessionId: params.sessionId,
			encodedCwd: params.encodedCwd,
			cwd: params.cwd,
			title: params.title,
			createdAt,
			updatedAt: ts,
			lastActivityAt: activity,
			source,
			totalCostUsd,
			repoId,
			worktreePath,
			branch,
		};
	}

	upsertJsonlIndex(update: JsonlIndexUpdate): void {
		this.db
			.query(
				`INSERT OR REPLACE INTO session_file_index (
					session_id, encoded_cwd, jsonl_path, file_mtime_ms, file_size,
					message_count, first_user_text, last_assistant_text, last_indexed_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				update.sessionId,
				update.encodedCwd,
				update.jsonlPath,
				update.fileMtimeMs,
				update.fileSize,
				update.messageCount,
				update.title,
				null,
				nowMs(),
			);
	}

	getFileIndex(sessionId: string, encodedCwd: string): FileIndexRow | null {
		return this.db
			.query(
				"SELECT * FROM session_file_index WHERE session_id = ? AND encoded_cwd = ?",
			)
			.get(sessionId, encodedCwd) as FileIndexRow | null;
	}

	listSessions(): SessionSummary[] {
		const rows = this.db
			.query(
				`SELECT
					sm.session_id,
					sm.encoded_cwd,
					sm.cwd,
					sm.title,
					sm.created_at,
					sm.updated_at,
					sm.last_activity_at,
					sm.source,
					sm.total_cost_usd,
					sm.repo_id,
					sm.worktree_path,
					sm.branch,
					COALESCE(fi.message_count, 0) AS message_count
				FROM session_metadata sm
				LEFT JOIN session_file_index fi
					ON fi.session_id = sm.session_id AND fi.encoded_cwd = sm.encoded_cwd
				ORDER BY sm.last_activity_at DESC`,
			)
			.all() as SessionSummaryRow[];

		return rows.map((row) => ({
			sessionId: row.session_id,
			encodedCwd: row.encoded_cwd,
			cwd: row.cwd,
			title: row.title,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			lastActivityAt: row.last_activity_at,
			source: row.source,
			totalCostUsd: row.total_cost_usd,
			messageCount: row.message_count,
			repoId: row.repo_id ?? undefined,
			worktreePath: row.worktree_path ?? undefined,
			branch: row.branch ?? undefined,
		}));
	}

	getSessionMetadata(
		sessionId: string,
		encodedCwd: string,
	): SessionMetadata | null {
		const row = this.getMetadataRow(sessionId, encodedCwd);
		if (!row) return null;
		return {
			sessionId: row.session_id,
			encodedCwd: row.encoded_cwd,
			cwd: row.cwd,
			title: row.title,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			lastActivityAt: row.last_activity_at,
			source: row.source,
			totalCostUsd: row.total_cost_usd,
			repoId: row.repo_id ?? undefined,
			worktreePath: row.worktree_path ?? undefined,
			branch: row.branch ?? undefined,
		};
	}

	findSessionCandidates(sessionId: string): SessionSummary[] {
		const rows = this.db
			.query(
				`SELECT
					sm.session_id,
					sm.encoded_cwd,
					sm.cwd,
					sm.title,
					sm.created_at,
					sm.updated_at,
					sm.last_activity_at,
					sm.source,
					sm.total_cost_usd,
					sm.repo_id,
					sm.worktree_path,
					sm.branch,
					COALESCE(fi.message_count, 0) AS message_count
				FROM session_metadata sm
				LEFT JOIN session_file_index fi
					ON fi.session_id = sm.session_id AND fi.encoded_cwd = sm.encoded_cwd
				WHERE sm.session_id = ?
				ORDER BY sm.last_activity_at DESC`,
			)
			.all(sessionId) as SessionSummaryRow[];

		return rows.map((row) => ({
			sessionId: row.session_id,
			encodedCwd: row.encoded_cwd,
			cwd: row.cwd,
			title: row.title,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			lastActivityAt: row.last_activity_at,
			source: row.source,
			totalCostUsd: row.total_cost_usd,
			messageCount: row.message_count,
			repoId: row.repo_id ?? undefined,
			worktreePath: row.worktree_path ?? undefined,
			branch: row.branch ?? undefined,
		}));
	}

	recordEvent(params: {
		sessionId: string;
		encodedCwd: string;
		eventType: string;
		payload?: unknown;
	}): void {
		this.db
			.query(
				`INSERT INTO session_events (
					session_id, encoded_cwd, event_type, payload_json, created_at
				) VALUES (?, ?, ?, ?, ?)`,
			)
			.run(
				params.sessionId,
				params.encodedCwd,
				params.eventType,
				params.payload ? JSON.stringify(params.payload) : null,
				nowMs(),
			);
	}

	// ── Repository methods ──────────────────────────────────────────

	insertRepository(params: {
		id: string;
		url: string;
		slug: string;
		bareRepoPath: string;
		defaultBranch: string;
	}): RepositoryInfo {
		const ts = nowMs();
		this.db
			.query(
				`INSERT OR REPLACE INTO repositories (
					id, url, slug, bare_repo_path, default_branch, created_at, last_fetched_at
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				params.id,
				params.url,
				params.slug,
				params.bareRepoPath,
				params.defaultBranch,
				ts,
				ts,
			);
		return {
			id: params.id,
			url: params.url,
			slug: params.slug,
			bareRepoPath: params.bareRepoPath,
			defaultBranch: params.defaultBranch,
			createdAt: ts,
			lastFetchedAt: ts,
		};
	}

	getRepositoryByUrl(url: string): RepositoryInfo | null {
		const row = this.db
			.query("SELECT * FROM repositories WHERE url = ?")
			.get(url) as RepositoryRow | null;
		if (!row) return null;
		return this.mapRepositoryRow(row);
	}

	getRepositoryById(id: string): RepositoryInfo | null {
		const row = this.db
			.query("SELECT * FROM repositories WHERE id = ?")
			.get(id) as RepositoryRow | null;
		if (!row) return null;
		return this.mapRepositoryRow(row);
	}

	listRepositories(): RepositoryInfo[] {
		const rows = this.db
			.query("SELECT * FROM repositories ORDER BY last_fetched_at DESC")
			.all() as RepositoryRow[];
		return rows.map((row) => this.mapRepositoryRow(row));
	}

	updateRepositoryFetched(id: string, defaultBranch: string): void {
		this.db
			.query(
				"UPDATE repositories SET last_fetched_at = ?, default_branch = ? WHERE id = ?",
			)
			.run(nowMs(), defaultBranch, id);
	}

	// ── SSH Connection methods ───────────────────────────────────────

	listSshConnections(): SshConnection[] {
		const rows = this.db
			.query(
				"SELECT * FROM ssh_connections ORDER BY last_connected_at DESC",
			)
			.all() as SshConnectionRow[];

		return rows.map((row) => this.mapSshConnectionRow(row));
	}

	createSshConnection(params: {
		sshDestination: string;
		title?: string;
	}): SshConnection {
		const id = crypto.randomUUID();
		const tmuxSessionName = `cc-${id.slice(0, 8)}`;
		const title = params.title || params.sshDestination;
		const ts = nowMs();

		this.db
			.query(
				`INSERT INTO ssh_connections (
					id, ssh_destination, tmux_session_name, title, created_at, last_connected_at
				) VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(id, params.sshDestination, tmuxSessionName, title, ts, ts);

		return { id, sshDestination: params.sshDestination, tmuxSessionName, title, createdAt: ts, lastConnectedAt: ts };
	}

	getSshConnection(id: string): SshConnection | null {
		const row = this.db
			.query("SELECT * FROM ssh_connections WHERE id = ?")
			.get(id) as SshConnectionRow | null;
		if (!row) return null;
		return this.mapSshConnectionRow(row);
	}

	deleteSshConnection(id: string): boolean {
		const result = this.db
			.query("DELETE FROM ssh_connections WHERE id = ?")
			.run(id);
		return result.changes > 0;
	}

	touchSshConnection(id: string): void {
		this.db
			.query(
				"UPDATE ssh_connections SET last_connected_at = ? WHERE id = ?",
			)
			.run(nowMs(), id);
	}

	private mapSshConnectionRow(row: SshConnectionRow): SshConnection {
		return {
			id: row.id,
			sshDestination: row.ssh_destination,
			tmuxSessionName: row.tmux_session_name,
			title: row.title,
			createdAt: row.created_at,
			lastConnectedAt: row.last_connected_at,
		};
	}

	private mapRepositoryRow(row: RepositoryRow): RepositoryInfo {
		return {
			id: row.id,
			url: row.url,
			slug: row.slug,
			bareRepoPath: row.bare_repo_path,
			defaultBranch: row.default_branch,
			createdAt: row.created_at,
			lastFetchedAt: row.last_fetched_at,
		};
	}

	close(): void {
		this.db.close();
	}
}
