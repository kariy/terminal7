import { afterEach, describe, expect, test } from "bun:test";
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

});
