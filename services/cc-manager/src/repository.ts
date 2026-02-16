import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type {
	DeviceRecord,
	JsonlIndexUpdate,
	SessionMetadata,
	SessionSummary,
} from "./types";
import { createSalt, createToken, hashWithSalt, nowMs } from "./utils";

interface DeviceRow {
	device_id: string;
	device_name: string;
	token_salt: string;
	token_hash: string;
	refresh_salt: string;
	refresh_hash: string;
	created_at: number;
	last_seen_at: number;
	revoked_at: number | null;
}

interface SessionMetadataRow {
	session_id: string;
	encoded_cwd: string;
	cwd: string;
	title: string;
	created_at: number;
	updated_at: number;
	last_activity_at: number;
	source: "db" | "jsonl" | "merged";
}

interface SessionSummaryRow extends SessionMetadataRow {
	message_count: number;
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
		if (hasV1) return;

		this.db.transaction(() => {
			this.db.exec(`
				CREATE TABLE IF NOT EXISTS device_registrations (
					device_id TEXT PRIMARY KEY,
					device_name TEXT NOT NULL,
					token_salt TEXT NOT NULL,
					token_hash TEXT NOT NULL,
					refresh_salt TEXT NOT NULL,
					refresh_hash TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					last_seen_at INTEGER NOT NULL,
					revoked_at INTEGER
				);
			`);

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
			this.db.exec(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_device_token_hash ON device_registrations(token_hash);",
			);
			this.db.exec(
				"CREATE UNIQUE INDEX IF NOT EXISTS idx_device_refresh_hash ON device_registrations(refresh_hash);",
			);

			this.db
				.query(
					"INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)",
				)
				.run(nowMs());
		})();
	}

	registerDevice(deviceName: string): {
		deviceId: string;
		accessToken: string;
		refreshToken: string;
	} {
		const deviceId = crypto.randomUUID();
		const accessToken = createToken(32);
		const refreshToken = createToken(48);
		const tokenSalt = createSalt(16);
		const refreshSalt = createSalt(16);
		const tokenHash = hashWithSalt(accessToken, tokenSalt);
		const refreshHash = hashWithSalt(refreshToken, refreshSalt);
		const ts = nowMs();

		this.db
			.query(
				`INSERT INTO device_registrations (
					device_id, device_name, token_salt, token_hash, refresh_salt, refresh_hash,
					created_at, last_seen_at, revoked_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
			)
			.run(
				deviceId,
				deviceName,
				tokenSalt,
				tokenHash,
				refreshSalt,
				refreshHash,
				ts,
				ts,
			);

		return { deviceId, accessToken, refreshToken };
	}

	authenticateAccessToken(token: string): DeviceRecord | null {
		const rows = this.db
			.query("SELECT * FROM device_registrations WHERE revoked_at IS NULL")
			.all() as DeviceRow[];

		for (const row of rows) {
			if (hashWithSalt(token, row.token_salt) === row.token_hash) {
				this.touchDevice(row.device_id);
				return this.mapDeviceRow(row);
			}
		}
		return null;
	}

	private touchDevice(deviceId: string): void {
		this.db
			.query("UPDATE device_registrations SET last_seen_at = ? WHERE device_id = ?")
			.run(nowMs(), deviceId);
	}

	private mapDeviceRow(row: DeviceRow): DeviceRecord {
		return {
			deviceId: row.device_id,
			deviceName: row.device_name,
			tokenSalt: row.token_salt,
			tokenHash: row.token_hash,
			refreshSalt: row.refresh_salt,
			refreshHash: row.refresh_hash,
			createdAt: row.created_at,
			lastSeenAt: row.last_seen_at,
			revokedAt: row.revoked_at,
		};
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
	}): SessionMetadata {
		const ts = nowMs();
		const activity = params.lastActivityAt ?? ts;
		const existing = this.getMetadataRow(params.sessionId, params.encodedCwd);
		const source: SessionMetadata["source"] = existing
			? existing.source === params.source
				? params.source
				: "merged"
			: params.source;
		const createdAt = existing?.created_at ?? ts;

		this.db
			.query(
				`INSERT OR REPLACE INTO session_metadata (
					session_id, encoded_cwd, cwd, title, created_at, updated_at, last_activity_at, source
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
			messageCount: row.message_count,
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
			messageCount: row.message_count,
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

	close(): void {
		this.db.close();
	}
}
