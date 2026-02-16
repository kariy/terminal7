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
	test("registers and authenticates a device token", () => {
		const repo = createRepository();
		const reg = repo.registerDevice("iphone-1");
		const device = repo.authenticateAccessToken(reg.accessToken);
		expect(device).not.toBeNull();
		expect(device?.deviceName).toBe("iphone-1");
		repo.close();
	});

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

});
