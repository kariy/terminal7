import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type {
	JsonlIndexUpdate,
	RepositoryInfo,
	SessionListCursor,
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

		// V5: Collapse duplicate encoded_cwd variants per (session_id, cwd)
		// and enforce uniqueness on that logical key.
		const hasV5 = this.db
			.query("SELECT 1 FROM schema_migrations WHERE version = 5")
			.get() as { "1": number } | null;
		if (!hasV5) {
			this.db.transaction(() => {
				this.collapseDuplicateSessionVariants();
				this.db.exec(
					"CREATE UNIQUE INDEX IF NOT EXISTS idx_session_metadata_session_cwd ON session_metadata(session_id, cwd);",
				);
				this.db
					.query(
						"INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)",
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

	private getMetadataRowBySessionAndCwd(
		sessionId: string,
		cwd: string,
	): SessionMetadataRow | null {
		return this.db
			.query(
				`SELECT *
				FROM session_metadata
				WHERE session_id = ? AND cwd = ?
				ORDER BY updated_at DESC, encoded_cwd DESC
				LIMIT 1`,
			)
			.get(sessionId, cwd) as SessionMetadataRow | null;
	}

	private resolveStoredEncodedCwd(
		sessionId: string,
		cwd: string,
		incomingEncodedCwd: string,
	): string {
		const existing = this.getMetadataRowBySessionAndCwd(sessionId, cwd);
		return existing?.encoded_cwd ?? incomingEncodedCwd;
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
		const canonicalEncodedCwd = this.resolveStoredEncodedCwd(
			params.sessionId,
			params.cwd,
			params.encodedCwd,
		);
		const existing = this.getMetadataRow(params.sessionId, canonicalEncodedCwd);
		const requestedActivity = params.lastActivityAt ?? ts;
		const existingActivity = existing?.last_activity_at ?? 0;
		const activity = Math.max(existingActivity, requestedActivity);
		const title =
			existing && requestedActivity < existingActivity
				? existing.title
				: params.title;
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
				canonicalEncodedCwd,
				params.cwd,
				title,
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
			encodedCwd: canonicalEncodedCwd,
			cwd: params.cwd,
			title,
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
		const canonicalEncodedCwd = this.resolveStoredEncodedCwd(
			update.sessionId,
			update.cwd,
			update.encodedCwd,
		);
		this.db
			.query(
				`INSERT OR REPLACE INTO session_file_index (
					session_id, encoded_cwd, jsonl_path, file_mtime_ms, file_size,
					message_count, first_user_text, last_assistant_text, last_indexed_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				update.sessionId,
				canonicalEncodedCwd,
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

	listSessionsPage(params: {
		limit: number;
		cursor?: SessionListCursor;
	}): { items: SessionSummary[]; nextCursor: SessionListCursor | null } {
		const limit = Math.max(1, Math.min(params.limit, 100));
		const allItems = this.listSessions();
		const filtered = params.cursor
			? allItems.filter((item) =>
					this.isBeforeSessionCursor(item, params.cursor!),
				)
			: allItems;

		const items = filtered.slice(0, limit);
		const hasMore = filtered.length > limit;
		const last = items.at(-1);

		return {
			items,
			nextCursor: hasMore && last
				? {
						lastActivityAt: last.lastActivityAt,
						sessionId: last.sessionId,
						encodedCwd: last.encodedCwd,
					}
				: null,
		};
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
				ORDER BY sm.last_activity_at DESC, sm.session_id DESC, sm.encoded_cwd DESC`,
			)
			.all() as SessionSummaryRow[];

		const collapsed = this.collapseSessionSummaryRows(rows);
		return collapsed.map((row) => this.mapSessionSummaryRow(row));
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
				ORDER BY sm.last_activity_at DESC, sm.session_id DESC, sm.encoded_cwd DESC`,
			)
			.all(sessionId) as SessionSummaryRow[];

		const collapsed = this.collapseSessionSummaryRows(rows);
		return collapsed.map((row) => this.mapSessionSummaryRow(row));
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

	private mapSessionSummaryRow(row: SessionSummaryRow): SessionSummary {
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
			messageCount: row.message_count,
			repoId: row.repo_id ?? undefined,
			worktreePath: row.worktree_path ?? undefined,
			branch: row.branch ?? undefined,
		};
	}

	private collapseSessionSummaryRows(
		rows: SessionSummaryRow[],
	): SessionSummaryRow[] {
		const grouped = new Map<string, SessionSummaryRow[]>();
		for (const row of rows) {
			const key = `${row.session_id}\u0000${row.cwd}`;
			const bucket = grouped.get(key);
			if (bucket) {
				bucket.push(row);
			} else {
				grouped.set(key, [row]);
			}
		}

		const collapsed: SessionSummaryRow[] = [];
		for (const groupRows of grouped.values()) {
			collapsed.push(this.mergeSessionVariantGroup(groupRows));
		}

		collapsed.sort((a, b) => this.compareSessionSummaryRows(a, b));
		return collapsed;
	}

	private collapseDuplicateSessionVariants(): void {
		const groups = this.db
			.query(
				`SELECT session_id, cwd
				FROM session_metadata
				GROUP BY session_id, cwd
				HAVING COUNT(*) > 1`,
			)
			.all() as Array<{ session_id: string; cwd: string }>;

		for (const group of groups) {
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
					WHERE sm.session_id = ? AND sm.cwd = ?`,
				)
				.all(group.session_id, group.cwd) as SessionSummaryRow[];
			if (rows.length < 2) continue;

			const merged = this.mergeSessionVariantGroup(rows);
			const variants = rows.map((row) => row.encoded_cwd);
			const nonCanonical = variants.filter(
				(encodedCwd) => encodedCwd !== merged.encoded_cwd,
			);

			this.db
				.query(
					`INSERT OR REPLACE INTO session_metadata (
						session_id, encoded_cwd, cwd, title, created_at, updated_at, last_activity_at, source, total_cost_usd, repo_id, worktree_path, branch
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					merged.session_id,
					merged.encoded_cwd,
					merged.cwd,
					merged.title,
					merged.created_at,
					merged.updated_at,
					merged.last_activity_at,
					merged.source,
					merged.total_cost_usd,
					merged.repo_id,
					merged.worktree_path,
					merged.branch,
				);

			const fileIndexRows = this.getFileIndexRowsByVariants(
				group.session_id,
				variants,
			);
			if (fileIndexRows.length > 0) {
				const bestFileIndex = this.pickPreferredFileIndexRow(fileIndexRows);
				this.db
					.query(
						`INSERT OR REPLACE INTO session_file_index (
							session_id, encoded_cwd, jsonl_path, file_mtime_ms, file_size,
							message_count, first_user_text, last_assistant_text, last_indexed_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.run(
						group.session_id,
						merged.encoded_cwd,
						bestFileIndex.jsonl_path,
						bestFileIndex.file_mtime_ms,
						bestFileIndex.file_size,
						bestFileIndex.message_count,
						bestFileIndex.first_user_text,
						bestFileIndex.last_assistant_text,
						bestFileIndex.last_indexed_at,
					);
			}

			if (nonCanonical.length === 0) continue;

			this.updateSessionEventEncodedCwd(
				group.session_id,
				variants,
				merged.encoded_cwd,
			);
			this.deleteMetadataByVariants(group.session_id, nonCanonical);
			this.deleteFileIndexByVariants(group.session_id, nonCanonical);
		}
	}

	private getFileIndexRowsByVariants(
		sessionId: string,
		variants: string[],
	): FileIndexRow[] {
		if (variants.length === 0) return [];
		const placeholders = variants.map(() => "?").join(", ");
		return this.db
			.query(
				`SELECT *
				FROM session_file_index
				WHERE session_id = ? AND encoded_cwd IN (${placeholders})`,
			)
			.all(sessionId, ...variants) as FileIndexRow[];
	}

	private pickPreferredFileIndexRow(rows: FileIndexRow[]): FileIndexRow {
		let best = rows[0]!;
		for (let i = 1; i < rows.length; i++) {
			const candidate = rows[i]!;
			if (candidate.message_count !== best.message_count) {
				if (candidate.message_count > best.message_count) {
					best = candidate;
				}
				continue;
			}
			if (candidate.file_mtime_ms !== best.file_mtime_ms) {
				if (candidate.file_mtime_ms > best.file_mtime_ms) {
					best = candidate;
				}
				continue;
			}
			if (candidate.last_indexed_at !== best.last_indexed_at) {
				if (candidate.last_indexed_at > best.last_indexed_at) {
					best = candidate;
				}
				continue;
			}
			if (candidate.file_size > best.file_size) {
				best = candidate;
			}
		}
		return best;
	}

	private updateSessionEventEncodedCwd(
		sessionId: string,
		variants: string[],
		canonicalEncodedCwd: string,
	): void {
		if (variants.length === 0) return;
		const placeholders = variants.map(() => "?").join(", ");
		this.db
			.query(
				`UPDATE session_events
				SET encoded_cwd = ?
				WHERE session_id = ? AND encoded_cwd IN (${placeholders})`,
			)
			.run(canonicalEncodedCwd, sessionId, ...variants);
	}

	private deleteMetadataByVariants(sessionId: string, variants: string[]): void {
		if (variants.length === 0) return;
		const placeholders = variants.map(() => "?").join(", ");
		this.db
			.query(
				`DELETE FROM session_metadata
				WHERE session_id = ? AND encoded_cwd IN (${placeholders})`,
			)
			.run(sessionId, ...variants);
	}

	private deleteFileIndexByVariants(sessionId: string, variants: string[]): void {
		if (variants.length === 0) return;
		const placeholders = variants.map(() => "?").join(", ");
		this.db
			.query(
				`DELETE FROM session_file_index
				WHERE session_id = ? AND encoded_cwd IN (${placeholders})`,
			)
			.run(sessionId, ...variants);
	}

	private mergeSessionVariantGroup(rows: SessionSummaryRow[]): SessionSummaryRow {
		if (rows.length === 1) return rows[0]!;

		let preferredEncodedRow = rows[0]!;
		let latestRow = rows[0]!;
		let repoRow = rows[0]!;
		let minCreatedAt = rows[0]!.created_at;
		let maxUpdatedAt = rows[0]!.updated_at;
		let maxLastActivityAt = rows[0]!.last_activity_at;
		let maxMessageCount = rows[0]!.message_count;
		let maxTotalCostUsd = rows[0]!.total_cost_usd;
		let source: SessionSummaryRow["source"] = rows[0]!.source;

		for (let i = 1; i < rows.length; i++) {
			const row = rows[i]!;
			if (this.compareVariantPriority(row, preferredEncodedRow) > 0) {
				preferredEncodedRow = row;
			}
			if (
				row.last_activity_at > latestRow.last_activity_at ||
				(row.last_activity_at === latestRow.last_activity_at &&
					row.updated_at > latestRow.updated_at)
			) {
				latestRow = row;
			}
			if (this.isRepoRowBetter(row, repoRow)) {
				repoRow = row;
			}
			if (row.source !== source) {
				source = "merged";
			}
			minCreatedAt = Math.min(minCreatedAt, row.created_at);
			maxUpdatedAt = Math.max(maxUpdatedAt, row.updated_at);
			maxLastActivityAt = Math.max(maxLastActivityAt, row.last_activity_at);
			maxMessageCount = Math.max(maxMessageCount, row.message_count);
			maxTotalCostUsd = Math.max(maxTotalCostUsd, row.total_cost_usd);
		}

		return {
			...preferredEncodedRow,
			title: latestRow.title,
			created_at: minCreatedAt,
			updated_at: maxUpdatedAt,
			last_activity_at: maxLastActivityAt,
			source,
			total_cost_usd: maxTotalCostUsd,
			message_count: maxMessageCount,
			repo_id: repoRow.repo_id,
			worktree_path: repoRow.worktree_path,
			branch: repoRow.branch,
		};
	}

	private compareVariantPriority(
		candidate: SessionSummaryRow,
		current: SessionSummaryRow,
	): number {
		if (candidate.message_count !== current.message_count) {
			return candidate.message_count - current.message_count;
		}
		const candidateSourceScore = candidate.source === "jsonl" ? 0 : 1;
		const currentSourceScore = current.source === "jsonl" ? 0 : 1;
		if (candidateSourceScore !== currentSourceScore) {
			return candidateSourceScore - currentSourceScore;
		}
		if (candidate.last_activity_at !== current.last_activity_at) {
			return candidate.last_activity_at - current.last_activity_at;
		}
		if (candidate.updated_at !== current.updated_at) {
			return candidate.updated_at - current.updated_at;
		}
		return candidate.encoded_cwd.localeCompare(current.encoded_cwd);
	}

	private hasRepoInfo(row: SessionSummaryRow): boolean {
		return (
			typeof row.repo_id === "string" ||
			typeof row.worktree_path === "string" ||
			typeof row.branch === "string"
		);
	}

	private isRepoRowBetter(
		candidate: SessionSummaryRow,
		current: SessionSummaryRow,
	): boolean {
		const candidateHasRepo = this.hasRepoInfo(candidate);
		const currentHasRepo = this.hasRepoInfo(current);
		if (candidateHasRepo !== currentHasRepo) {
			return candidateHasRepo;
		}
		if (candidate.last_activity_at !== current.last_activity_at) {
			return candidate.last_activity_at > current.last_activity_at;
		}
		return candidate.updated_at > current.updated_at;
	}

	private compareSessionSummaryRows(
		a: SessionSummaryRow,
		b: SessionSummaryRow,
	): number {
		if (a.last_activity_at !== b.last_activity_at) {
			return b.last_activity_at - a.last_activity_at;
		}
		const sessionCmp = b.session_id.localeCompare(a.session_id);
		if (sessionCmp !== 0) return sessionCmp;
		return b.encoded_cwd.localeCompare(a.encoded_cwd);
	}

	private isBeforeSessionCursor(
		session: SessionSummary,
		cursor: SessionListCursor,
	): boolean {
		if (session.lastActivityAt < cursor.lastActivityAt) return true;
		if (session.lastActivityAt > cursor.lastActivityAt) return false;
		if (session.sessionId < cursor.sessionId) return true;
		if (session.sessionId > cursor.sessionId) return false;
		return session.encodedCwd < cursor.encodedCwd;
	}

	close(): void {
		this.db.close();
	}
}
