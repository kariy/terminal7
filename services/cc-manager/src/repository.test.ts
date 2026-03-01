import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ManagerRepository } from "./repository";

const tempDirs: string[] = [];

function createRepository(): ManagerRepository {
	const dir = mkdtempSync(join(tmpdir(), "cc-manager-repo-"));
	tempDirs.push(dir);
	return new ManagerRepository(join(dir, "manager.db"));
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("ManagerRepository", () => {
	test("merges metadata sources when session exists in DB and JSONL", () => {
		const repo = createRepository();
		repo.upsertSessionMetadata({
			sessionId: "session-1",
			encodedCwd: "-tmp-project",
			cwd: "/tmp/project",
			title: "From DB",
			source: "db",
		});
		repo.upsertSessionMetadata({
			sessionId: "session-1",
			encodedCwd: "-tmp-project",
			cwd: "/tmp/project",
			title: "From JSONL",
			source: "jsonl",
		});

		const session = repo.getSessionMetadata("session-1", "-tmp-project");
		expect(session?.source).toBe("merged");
		repo.close();
	});

	test("accumulates total_cost_usd across multiple upserts", () => {
		const repo = createRepository();
		repo.upsertSessionMetadata({
			sessionId: "session-cost",
			encodedCwd: "-tmp-project",
			cwd: "/tmp/project",
			title: "Cost test",
			source: "db",
			costToAdd: 0.05,
		});
		repo.upsertSessionMetadata({
			sessionId: "session-cost",
			encodedCwd: "-tmp-project",
			cwd: "/tmp/project",
			title: "Cost test",
			source: "db",
			costToAdd: 0.10,
		});

		const sessions = repo.listSessions();
		const session = sessions.find((s) => s.sessionId === "session-cost");
		expect(session?.totalCostUsd).toBeCloseTo(0.15);

		const metadata = repo.getSessionMetadata("session-cost", "-tmp-project");
		expect(metadata?.totalCostUsd).toBeCloseTo(0.15);
		repo.close();
	});

	test("listSessionsPage paginates with stable keyset ordering", () => {
		const repo = createRepository();
		const ts = 2_000;

		repo.upsertSessionMetadata({
			sessionId: "a",
			encodedCwd: "-1",
			cwd: "/a1",
			title: "a1",
			lastActivityAt: ts,
			source: "db",
		});
		repo.upsertSessionMetadata({
			sessionId: "a",
			encodedCwd: "-2",
			cwd: "/a2",
			title: "a2",
			lastActivityAt: ts,
			source: "db",
		});
		repo.upsertSessionMetadata({
			sessionId: "b",
			encodedCwd: "-1",
			cwd: "/b1",
			title: "b1",
			lastActivityAt: ts,
			source: "db",
		});

		const first = repo.listSessionsPage({ limit: 2 });
		expect(first.items.length).toBe(2);
		expect(first.items[0]?.sessionId).toBe("b");
		expect(first.items[0]?.encodedCwd).toBe("-1");
		expect(first.items[1]?.sessionId).toBe("a");
		expect(first.items[1]?.encodedCwd).toBe("-2");
		expect(first.nextCursor).toBeDefined();

		const second = repo.listSessionsPage({
			limit: 2,
			cursor: first.nextCursor ?? undefined,
		});
		expect(second.items.length).toBe(1);
		expect(second.items[0]?.sessionId).toBe("a");
		expect(second.items[0]?.encodedCwd).toBe("-1");
		expect(second.nextCursor).toBeNull();
		repo.close();
	});

	test("canonicalizes writes to existing (session_id, cwd) encoded_cwd variant", () => {
		const repo = createRepository();
		const sessionId = "session-variant";
		const canonicalEncodedCwd =
			"-users-kariy-.cc-manager-projects-worktrees-abc";
		const alternateEncodedCwd =
			"-users-kariy--cc-manager-projects-worktrees-abc";
		const cwd = "/Users/kariy/.cc-manager/projects/worktrees/abc";

		repo.upsertSessionMetadata({
			sessionId,
			encodedCwd: canonicalEncodedCwd,
			cwd,
			title: "Newer DB Title",
			lastActivityAt: 2_000,
			source: "db",
			costToAdd: 0.2,
		});

		repo.upsertSessionMetadata({
			sessionId,
			encodedCwd: alternateEncodedCwd,
			cwd,
			title: "Older JSONL Title",
			lastActivityAt: 1_500,
			source: "jsonl",
		});
		repo.upsertJsonlIndex({
			sessionId,
			encodedCwd: alternateEncodedCwd,
			cwd,
			title: "Older JSONL Title",
			lastActivityAt: 1_500,
			messageCount: 32,
			jsonlPath: "/tmp/demo.jsonl",
			fileSize: 123,
			fileMtimeMs: 456,
		});

		const sessions = repo.listSessions();
		expect(sessions.length).toBe(1);
		expect(sessions[0]?.sessionId).toBe(sessionId);
		expect(sessions[0]?.encodedCwd).toBe(canonicalEncodedCwd);
		expect(sessions[0]?.messageCount).toBe(32);
		expect(sessions[0]?.totalCostUsd).toBeCloseTo(0.2);
		expect(sessions[0]?.title).toBe("Newer DB Title");

		const page = repo.listSessionsPage({ limit: 10 });
		expect(page.items.length).toBe(1);
		expect(page.items[0]?.encodedCwd).toBe(canonicalEncodedCwd);

		const candidates = repo.findSessionCandidates(sessionId);
		expect(candidates.length).toBe(1);
		expect(candidates[0]?.encodedCwd).toBe(canonicalEncodedCwd);

		repo.close();
	});

	test("migration v5 collapses pre-existing duplicate variants", () => {
		const dir = mkdtempSync(join(tmpdir(), "cc-manager-repo-mig-"));
		tempDirs.push(dir);
		const dbPath = join(dir, "manager.db");
		const db = new Database(dbPath, { create: true, strict: true });

		db.exec(`
			CREATE TABLE schema_migrations (
				version INTEGER PRIMARY KEY,
				applied_at INTEGER NOT NULL
			);
			CREATE TABLE session_metadata (
				session_id TEXT NOT NULL,
				encoded_cwd TEXT NOT NULL,
				cwd TEXT NOT NULL,
				title TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				last_activity_at INTEGER NOT NULL,
				source TEXT NOT NULL,
				total_cost_usd REAL NOT NULL DEFAULT 0,
				repo_id TEXT,
				worktree_path TEXT,
				branch TEXT,
				PRIMARY KEY (session_id, encoded_cwd)
			);
			CREATE TABLE session_events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id TEXT NOT NULL,
				encoded_cwd TEXT NOT NULL,
				event_type TEXT NOT NULL,
				payload_json TEXT,
				created_at INTEGER NOT NULL
			);
			CREATE TABLE session_file_index (
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
		for (let version = 1; version <= 4; version++) {
			db.query(
				"INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
			).run(version, version);
		}

		const sessionId = "session-dup";
		const cwd = "/Users/kariy/.cc-manager/projects/worktrees/dup";
		const dbVariant = "-Users-kariy-.cc-manager-projects-worktrees-dup";
		const jsonlVariant = "-Users-kariy--cc-manager-projects-worktrees-dup";

		db.query(
			`INSERT INTO session_metadata (
				session_id, encoded_cwd, cwd, title, created_at, updated_at, last_activity_at, source, total_cost_usd
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(sessionId, dbVariant, cwd, "Live title", 100, 200, 300, "db", 0.1);
		db.query(
			`INSERT INTO session_metadata (
				session_id, encoded_cwd, cwd, title, created_at, updated_at, last_activity_at, source, total_cost_usd
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(sessionId, jsonlVariant, cwd, "Jsonl title", 120, 180, 280, "jsonl", 0);
		db.query(
			`INSERT INTO session_file_index (
				session_id, encoded_cwd, jsonl_path, file_mtime_ms, file_size, message_count, first_user_text, last_assistant_text, last_indexed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			sessionId,
			jsonlVariant,
			"/tmp/dup.jsonl",
			400,
			1000,
			32,
			"hello",
			"world",
			500,
		);
		db.close();

		const repo = new ManagerRepository(dbPath);
		const sessions = repo.findSessionCandidates(sessionId);
		expect(sessions.length).toBe(1);
		expect(sessions[0]?.encodedCwd).toBe(jsonlVariant);
		expect(sessions[0]?.messageCount).toBe(32);
		expect(sessions[0]?.title).toBe("Live title");
		expect(sessions[0]?.source).toBe("merged");

		const migratedDb = new Database(dbPath, { strict: true });
		const rowCount = migratedDb
			.query(
				"SELECT COUNT(*) AS count FROM session_metadata WHERE session_id = ? AND cwd = ?",
			)
			.get(sessionId, cwd) as { count: number };
		expect(rowCount.count).toBe(1);
		const uniqueIndex = migratedDb
			.query(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_session_metadata_session_cwd'",
			)
			.get() as { name: string } | null;
		expect(uniqueIndex?.name).toBe("idx_session_metadata_session_cwd");
		migratedDb.close();
		repo.close();
	});

});
