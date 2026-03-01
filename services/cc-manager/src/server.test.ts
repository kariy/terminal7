import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
	createTestServer,
	destroyTestServer,
	type TestContext,
} from "./test-utils";

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestServer();
});

afterEach(() => {
	destroyTestServer(ctx);
});

describe("GET /health", () => {
	test("returns 200 with { status: 'ok', time: <valid ISO string> }", async () => {
		const res = await fetch(`${ctx.baseUrl}/health`);
		expect(res.status).toBe(200);

		const body = (await res.json()) as { status: string; time: string };
		expect(body.status).toBe("ok");
		expect(typeof body.time).toBe("string");
		// Validate ISO string parses to a valid date
		expect(Number.isNaN(new Date(body.time).getTime())).toBe(false);
	});

	test("content-type is application/json", async () => {
		const res = await fetch(`${ctx.baseUrl}/health`);
		expect(res.headers.get("content-type")).toContain("application/json");
	});
});

describe("GET /v1/sessions", () => {
	test("returns 200 with { items: [], next_cursor: null } when DB is empty", async () => {
		const res = await fetch(`${ctx.baseUrl}/v1/sessions`);
		expect(res.status).toBe(200);

		const body = (await res.json()) as {
			items: unknown[];
			next_cursor: string | null;
		};
		expect(body.items).toEqual([]);
		expect(body.next_cursor).toBeNull();
	});

	test("returns sessions with correct shape after inserting via repository", async () => {
		ctx.repository.upsertSessionMetadata({
			sessionId: "sess-1",
			encodedCwd: "-home-user",
			cwd: "/home/user",
			title: "Test session",
			source: "db",
		});

		const res = await fetch(`${ctx.baseUrl}/v1/sessions`);
		expect(res.status).toBe(200);

		const body = (await res.json()) as {
			items: Record<string, unknown>[];
			next_cursor: string | null;
		};
		expect(body.items.length).toBe(1);
		expect(body.next_cursor).toBeNull();

		const session = body.items[0]!;
		expect(session.session_id).toBe("sess-1");
		expect(session.encoded_cwd).toBe("-home-user");
		expect(session.cwd).toBe("/home/user");
		expect(session.title).toBe("Test session");
	});

	test("session objects have all expected fields with correct types", async () => {
		ctx.repository.upsertSessionMetadata({
			sessionId: "sess-2",
			encodedCwd: "-tmp",
			cwd: "/tmp",
			title: "Type check",
			source: "db",
		});

		const res = await fetch(`${ctx.baseUrl}/v1/sessions`);
		const body = (await res.json()) as { items: Record<string, unknown>[] };
		const session = body.items[0]!;

		expect(typeof session.session_id).toBe("string");
		expect(typeof session.encoded_cwd).toBe("string");
		expect(typeof session.cwd).toBe("string");
		expect(typeof session.title).toBe("string");
		expect(typeof session.created_at).toBe("number");
		expect(typeof session.updated_at).toBe("number");
		expect(typeof session.last_activity_at).toBe("number");
		expect(typeof session.message_count).toBe("number");
	});

	test("sessions ordered by last_activity_at descending", async () => {
		ctx.repository.upsertSessionMetadata({
			sessionId: "sess-old",
			encodedCwd: "-a",
			cwd: "/a",
			title: "Older",
			lastActivityAt: 1000,
			source: "db",
		});
		ctx.repository.upsertSessionMetadata({
			sessionId: "sess-new",
			encodedCwd: "-b",
			cwd: "/b",
			title: "Newer",
			lastActivityAt: 2000,
			source: "db",
		});

		const res = await fetch(`${ctx.baseUrl}/v1/sessions`);
		const body = (await res.json()) as { items: Record<string, unknown>[] };
		expect(body.items.length).toBe(2);
		expect(body.items[0]!.session_id).toBe("sess-new");
		expect(body.items[1]!.session_id).toBe("sess-old");
	});

	test("supports cursor pagination using limit and cursor", async () => {
		ctx.repository.upsertSessionMetadata({
			sessionId: "sess-1",
			encodedCwd: "-1",
			cwd: "/1",
			title: "1",
			lastActivityAt: 1001,
			source: "db",
		});
		ctx.repository.upsertSessionMetadata({
			sessionId: "sess-2",
			encodedCwd: "-2",
			cwd: "/2",
			title: "2",
			lastActivityAt: 1002,
			source: "db",
		});
		ctx.repository.upsertSessionMetadata({
			sessionId: "sess-3",
			encodedCwd: "-3",
			cwd: "/3",
			title: "3",
			lastActivityAt: 1003,
			source: "db",
		});

		const firstRes = await fetch(`${ctx.baseUrl}/v1/sessions?limit=2`);
		expect(firstRes.status).toBe(200);
		const firstBody = (await firstRes.json()) as {
			items: Record<string, unknown>[];
			next_cursor: string | null;
		};
		expect(firstBody.items.length).toBe(2);
		expect(firstBody.items[0]?.session_id).toBe("sess-3");
		expect(firstBody.items[1]?.session_id).toBe("sess-2");
		expect(typeof firstBody.next_cursor).toBe("string");

		const secondRes = await fetch(
			`${ctx.baseUrl}/v1/sessions?limit=2&cursor=${encodeURIComponent(firstBody.next_cursor!)}`,
		);
		expect(secondRes.status).toBe(200);
		const secondBody = (await secondRes.json()) as {
			items: Record<string, unknown>[];
			next_cursor: string | null;
		};
		expect(secondBody.items.length).toBe(1);
		expect(secondBody.items[0]?.session_id).toBe("sess-1");
		expect(secondBody.next_cursor).toBeNull();
	});

	test("returns 400 invalid_cursor for malformed cursor", async () => {
		const res = await fetch(`${ctx.baseUrl}/v1/sessions?cursor=not-base64`);
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			error: { code: string; message: string };
		};
		expect(body.error.code).toBe("invalid_cursor");
	});
});

describe("GET / and GET /sessions/*", () => {
	test("GET / returns 200", async () => {
		const res = await fetch(`${ctx.baseUrl}/`);
		expect(res.status).toBe(200);
	});

	test("GET /sessions/some-id returns 200", async () => {
		const res = await fetch(`${ctx.baseUrl}/sessions/some-id`);
		expect(res.status).toBe(200);
	});
});

describe("GET /v1/sessions/:id/history", () => {
	test("falls back when encoded_cwd query param is stale and still returns history", async () => {
		const historyCtx = createTestServer({ withIndexer: true });
		const sessionId = "sess-history-fallback";
		const canonicalEncodedCwd = "-Users-kariy-.cc-manager-projects-worktrees-abc";
		const staleEncodedCwd = "-Users-kariy--cc-manager-projects-worktrees-abc";
		const cwd = "/Users/kariy/.cc-manager/projects/worktrees/abc";
		try {
			const sessionDir = join(
				historyCtx.config.claudeProjectsDir,
				canonicalEncodedCwd,
			);
			const jsonlPath = join(sessionDir, `${sessionId}.jsonl`);

			mkdirSync(sessionDir, { recursive: true });
			writeFileSync(
				jsonlPath,
				[
					JSON.stringify({
						type: "user",
						uuid: "u1",
						cwd,
						message: { content: [{ type: "text", text: "hello" }] },
					}),
					JSON.stringify({
						type: "assistant",
						uuid: "a1",
						message: { content: [{ type: "text", text: "hi" }] },
					}),
				].join("\n"),
				"utf8",
			);

			historyCtx.repository.upsertSessionMetadata({
				sessionId,
				encodedCwd: canonicalEncodedCwd,
				cwd,
				title: "History fallback",
				source: "db",
			});
			historyCtx.repository.upsertJsonlIndex({
				sessionId,
				encodedCwd: canonicalEncodedCwd,
				cwd,
				title: "History fallback",
				lastActivityAt: Date.now(),
				messageCount: 2,
				jsonlPath,
				fileSize: 100,
				fileMtimeMs: Date.now(),
			});

			const res = await fetch(
				`${historyCtx.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/history?encoded_cwd=${encodeURIComponent(staleEncodedCwd)}`,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				session_id: string;
				encoded_cwd: string;
				total_messages: number;
				messages: Array<{ role: string; text: string }>;
			};
			expect(body.session_id).toBe(sessionId);
			expect(body.encoded_cwd).toBe(canonicalEncodedCwd);
			expect(body.total_messages).toBe(2);
			expect(body.messages.length).toBe(2);
			expect(body.messages[0]?.role).toBe("user");
			expect(body.messages[0]?.text).toBe("hello");
		} finally {
			destroyTestServer(historyCtx);
		}
	});
});

describe("unknown routes", () => {
	test("GET /v1/nonexistent returns 404 with { error: { code: 'not_found' } }", async () => {
		const res = await fetch(`${ctx.baseUrl}/v1/nonexistent`);
		expect(res.status).toBe(404);

		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("not_found");
	});

	test("POST /v1/sessions returns 404 (only GET is matched)", async () => {
		const res = await fetch(`${ctx.baseUrl}/v1/sessions`, {
			method: "POST",
		});
		expect(res.status).toBe(404);
	});
});
