import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ClaudeJsonlIndexer } from "./jsonl-indexer";
import { ManagerRepository } from "./repository";

const tempDirs: string[] = [];

function setup() {
	const root = mkdtempSync(join(tmpdir(), "cc-indexer-"));
	tempDirs.push(root);
	const dbPath = join(root, "manager.db");
	const projects = join(root, "projects");
	mkdirSync(projects, { recursive: true });
	return {
		repository: new ManagerRepository(dbPath),
		projects,
	};
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("ClaudeJsonlIndexer", () => {
	test("indexes JSONL sessions and reads history with cursor", () => {
		const { repository, projects } = setup();
		const encodedCwd = "-tmp-demo";
		const sessionId = "123e4567-e89b-12d3-a456-426614174000";
		const sessionDir = join(projects, encodedCwd);
		mkdirSync(sessionDir, { recursive: true });

		const jsonl = [
			JSON.stringify({
				type: "user",
				uuid: "u1",
				message: { content: [{ type: "text", text: "hello" }] },
			}),
			JSON.stringify({
				type: "assistant",
				uuid: "a1",
				message: { content: [{ type: "text", text: "hi there" }] },
			}),
		].join("\n");

		writeFileSync(join(sessionDir, `${sessionId}.jsonl`), jsonl, "utf8");

		const indexer = new ClaudeJsonlIndexer(projects, repository, 1);
		const stats = indexer.refreshIndex();
		expect(stats.indexed).toBe(1);

		const sessions = repository.listSessions();
		expect(sessions.length).toBe(1);
		expect(sessions[0]?.sessionId).toBe(sessionId);

		const history1 = indexer.readHistory({ sessionId, encodedCwd, cursor: 0 });
		expect(history1.messages.length).toBe(1);
		expect(history1.nextCursor).toBe(1);
		expect(history1.messages[0]?.role).toBe("user");
		expect(history1.messages[0]?.content_blocks).toEqual([{ type: "text", text: "hello" }]);

		const history2 = indexer.readHistory({
			sessionId,
			encodedCwd,
			cursor: history1.nextCursor ?? 0,
		});
		expect(history2.messages.length).toBe(1);
		expect(history2.messages[0]?.role).toBe("assistant");
		expect(history2.messages[0]?.content_blocks).toEqual([{ type: "text", text: "hi there" }]);
		repository.close();
	});

	test("reuses existing encoded_cwd variant for same session/cwd to avoid duplicates", () => {
		const { repository, projects } = setup();
		const sessionId = "123e4567-e89b-12d3-a456-426614174999";
		const canonicalEncodedCwd =
			"-Users-kariy-.cc-manager-projects-worktrees-demo";
		const incomingEncodedCwd =
			"-Users-kariy--cc-manager-projects-worktrees-demo";
		const cwd = "/Users/kariy/.cc-manager/projects/worktrees/demo";

		// Existing DB-tracked variant from live session usage.
		repository.upsertSessionMetadata({
			sessionId,
			encodedCwd: canonicalEncodedCwd,
			cwd,
			title: "Live title",
			source: "db",
			lastActivityAt: 2_000,
		});

		// JSONL discovered under a different encoded_cwd variant.
		const incomingDir = join(projects, incomingEncodedCwd);
		mkdirSync(incomingDir, { recursive: true });
		const jsonl = [
			JSON.stringify({
				type: "user",
				uuid: "u1",
				cwd,
				message: { content: [{ type: "text", text: "hello from jsonl" }] },
			}),
			JSON.stringify({
				type: "assistant",
				uuid: "a1",
				message: { content: [{ type: "text", text: "hi" }] },
			}),
		].join("\n");
		writeFileSync(join(incomingDir, `${sessionId}.jsonl`), jsonl, "utf8");

		const indexer = new ClaudeJsonlIndexer(projects, repository, 100);
		const stats = indexer.refreshIndex();
		expect(stats.indexed).toBe(1);

		// We should still have a single logical session.
		const sessions = repository.listSessions();
		expect(sessions.length).toBe(1);
		expect(sessions[0]?.sessionId).toBe(sessionId);
		expect(sessions[0]?.encodedCwd).toBe(canonicalEncodedCwd);
		expect(sessions[0]?.messageCount).toBe(2);

		// File index should be written to canonical variant (with actual incoming jsonl_path).
		const canonicalIndex = repository.getFileIndex(sessionId, canonicalEncodedCwd);
		expect(canonicalIndex).toBeTruthy();
		expect(canonicalIndex?.jsonl_path).toBe(
			join(incomingDir, `${sessionId}.jsonl`),
		);

		repository.close();
	});
});
