import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FileIndexService } from "./file-index-service";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

async function waitForIndexed(
	service: FileIndexService,
	encodedCwd: string,
	cwd: string,
	timeoutMs = 3000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = service.search({
			encodedCwd,
			cwd,
			query: "",
			limit: 10,
		});
		if (!result.indexing) return;
		await Bun.sleep(20);
	}
	throw new Error(`Timed out waiting for file index to finish (${timeoutMs}ms)`);
}

describe("FileIndexService", () => {
	test("indexes files/directories recursively and ignores node_modules + target", async () => {
		const root = mkdtempSync(join(tmpdir(), "cc-file-index-"));
		tempDirs.push(root);

		mkdirSync(join(root, "src", "utils"), { recursive: true });
		mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
		mkdirSync(join(root, "target", "debug"), { recursive: true });
		writeFileSync(join(root, "src", "index.ts"), "export {};\n");
		writeFileSync(join(root, "src", "utils", "path.ts"), "export {};\n");
		writeFileSync(join(root, "README.md"), "# test\n");
		writeFileSync(
			join(root, "node_modules", "pkg", "index.js"),
			"module.exports = {};",
		);
		writeFileSync(join(root, "target", "debug", "bin"), "binary");

		const service = new FileIndexService({
			rebuildDebounceMs: 10,
			cleanupIntervalMs: 60_000,
			idleTtlMs: 60_000,
		});
		const encodedCwd = "-tmp-file-index";

		try {
			service.ensureIndex({ encodedCwd, cwd: root });
			await waitForIndexed(service, encodedCwd, root);

			const all = service.search({
				encodedCwd,
				cwd: root,
				query: "",
				limit: 50,
			});
			const paths = all.entries.map((entry) => entry.path);

			expect(paths).toContain("src");
			expect(paths).toContain("src/index.ts");
			expect(paths).toContain("src/utils");
			expect(paths).toContain("src/utils/path.ts");
			expect(paths).toContain("README.md");
			expect(paths).not.toContain("node_modules");
			expect(paths).not.toContain("node_modules/pkg");
			expect(paths).not.toContain("target");
			expect(paths).not.toContain("target/debug/bin");
		} finally {
			service.dispose();
		}
	});

	test("matches by substring query", async () => {
		const root = mkdtempSync(join(tmpdir(), "cc-file-index-"));
		tempDirs.push(root);

		mkdirSync(join(root, "packages", "api"), { recursive: true });
		writeFileSync(join(root, "packages", "api", "router.ts"), "export {};\n");
		writeFileSync(join(root, "notes.txt"), "notes\n");

		const service = new FileIndexService({
			rebuildDebounceMs: 10,
			cleanupIntervalMs: 60_000,
			idleTtlMs: 60_000,
		});
		const encodedCwd = "-tmp-file-index-substring";

		try {
			service.ensureIndex({ encodedCwd, cwd: root });
			await waitForIndexed(service, encodedCwd, root);

			const result = service.search({
				encodedCwd,
				cwd: root,
				query: "router",
				limit: 10,
			});

			const paths = result.entries.map((entry) => entry.path);
			expect(paths).toContain("packages/api/router.ts");
		} finally {
			service.dispose();
		}
	});
});
