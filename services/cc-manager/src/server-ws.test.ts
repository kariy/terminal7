import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	createTestServer,
	destroyTestServer,
	WsTestClient,
	type TestContext,
} from "./test-utils";

let ctx: TestContext;
let ws: WsTestClient;

beforeEach(() => {
	ctx = createTestServer();
});

afterEach(() => {
	ws?.close();
	destroyTestServer(ctx);
});

async function connect(): Promise<WsTestClient> {
	ws = new WsTestClient(ctx.wsUrl);
	await ws.connected();
	return ws;
}

describe("connection", () => {
	test("server sends hello with type, requires_auth, and server_time", async () => {
		await connect();
		const hello = (await ws.nextMessage()) as Record<string, unknown>;
		expect(hello.type).toBe("hello");
		expect(typeof hello.requires_auth).toBe("boolean");
		expect(typeof hello.server_time).toBe("number");
	});

	test("server_time is recent (within 5s of Date.now())", async () => {
		await connect();
		const hello = (await ws.nextMessage()) as { server_time: number };
		const diff = Math.abs(Date.now() - hello.server_time);
		expect(diff).toBeLessThan(5000);
	});
});

describe("ping/pong", () => {
	test('{ type: "ping" } receives { type: "pong", server_time }', async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({ type: "ping" });
		const pong = (await ws.nextMessage()) as Record<string, unknown>;
		expect(pong.type).toBe("pong");
		expect(typeof pong.server_time).toBe("number");
	});
});

describe("session.create flow", () => {
	test("sends session.created, stream.message(s), stream.done in order", async () => {
		ctx.claudeService.setBehavior(async (args) => {
			args.onSessionId("sid-" + crypto.randomUUID().slice(0, 8));
			args.onMessage({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Hello " },
				},
			} as any);
			args.onMessage({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "world" },
				},
			} as any);
			args.onDone();
		});

		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-1",
			prompt: "Say hello",
			cwd: "/tmp",
		});

		const messages = await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const types = messages.map(
			(m) => (m as Record<string, unknown>).type,
		);
		expect(types).toEqual([
			"session.created",
			"stream.message",
			"stream.message",
			"stream.done",
		]);
	});

	test("session.created has session_id, request_id, encoded_cwd, cwd", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-shape",
			prompt: "Test prompt",
			cwd: "/home/user",
		});

		const created = (await ws.nextMessage()) as Record<string, unknown>;
		expect(created.type).toBe("session.created");
		expect(created.request_id).toBe("req-shape");
		expect(typeof created.session_id).toBe("string");
		expect(typeof created.encoded_cwd).toBe("string");
		expect(typeof created.cwd).toBe("string");
	});

	test("stream.done has request_id matching the original request", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-match",
			prompt: "Test",
			cwd: "/tmp",
		});

		const messages = await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const done = messages.find(
			(m) => (m as Record<string, unknown>).type === "stream.done",
		) as Record<string, unknown>;
		expect(done.request_id).toBe("req-match");
	});

	test("without request_id, server generates one (non-empty string)", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			prompt: "No request id",
			cwd: "/tmp",
		});

		const created = (await ws.nextMessage()) as Record<string, unknown>;
		expect(created.type).toBe("session.created");
		expect(typeof created.request_id).toBe("string");
		expect((created.request_id as string).length).toBeGreaterThan(0);
	});
});

describe("session.resume/send flow", () => {
	test("with existing session → receives session.state(session_resumed), messages, done", async () => {
		// First create a session via the repository
		const sessionId = "sess-resume-test";
		const encodedCwd = "-tmp";
		ctx.repository.upsertSessionMetadata({
			sessionId,
			encodedCwd,
			cwd: "/tmp",
			title: "Resume test",
			source: "db",
		});

		ctx.claudeService.setBehavior(async (args) => {
			args.onSessionId(sessionId);
			args.onMessage({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Resumed!" },
				},
			} as any);
			args.onDone();
		});

		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.resume",
			request_id: "req-resume",
			session_id: sessionId,
			encoded_cwd: encodedCwd,
			prompt: "Continue",
		});

		const messages = await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "stream.done",
		);

		const types = messages.map(
			(m) => (m as Record<string, unknown>).type,
		);
		expect(types).toEqual([
			"session.state",
			"stream.message",
			"stream.done",
		]);

		const state = messages[0] as Record<string, unknown>;
		expect(state.status).toBe("session_resumed");
	});

	test("with non-existent session → receives error(session_not_found)", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.resume",
			request_id: "req-404",
			session_id: "nonexistent",
			encoded_cwd: "-none",
			prompt: "Hello",
		});

		const error = (await ws.nextMessage()) as Record<string, unknown>;
		expect(error.type).toBe("error");
		expect(error.code).toBe("session_not_found");
		expect(error.request_id).toBe("req-404");
	});
});

describe("session.stop", () => {
	test("unknown request_id → session.state with status 'not_found'", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.stop",
			request_id: "unknown-req",
		});

		const state = (await ws.nextMessage()) as Record<string, unknown>;
		expect(state.type).toBe("session.state");
		expect(state.status).toBe("not_found");
		expect(state.request_id).toBe("unknown-req");
	});
});

describe("error handling", () => {
	test("invalid JSON → error(invalid_json)", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		// Send raw non-JSON text
		ws.send = function rawSend(payload: unknown) {
			// bypass JSON.stringify for this test
		};
		// Directly access the underlying WS to send raw text
		const rawWs = new WebSocket(ctx.wsUrl);
		await new Promise<void>((resolve) =>
			rawWs.addEventListener("open", () => resolve()),
		);
		// consume hello from rawWs
		await new Promise<void>((resolve) =>
			rawWs.addEventListener("message", () => resolve(), { once: true }),
		);

		rawWs.send("not valid json {{{");

		const error = await new Promise<Record<string, unknown>>((resolve) =>
			rawWs.addEventListener(
				"message",
				(ev) => resolve(JSON.parse(ev.data as string)),
				{ once: true },
			),
		);

		expect(error.type).toBe("error");
		expect(error.code).toBe("invalid_json");
		rawWs.close();
	});

	test("invalid payload schema → error(invalid_payload) with details", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({ type: "session.create" }); // missing required `prompt`

		const error = (await ws.nextMessage()) as Record<string, unknown>;
		expect(error.type).toBe("error");
		expect(error.code).toBe("invalid_payload");
		expect(error.details).toBeDefined();
	});

	test("empty prompt → error(invalid_payload)", async () => {
		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({ type: "session.create", prompt: "" });

		const error = (await ws.nextMessage()) as Record<string, unknown>;
		expect(error.type).toBe("error");
		expect(error.code).toBe("invalid_payload");
	});
});

describe("streaming errors", () => {
	test("ClaudeService error → receives error(prompt_failed) with error message", async () => {
		ctx.claudeService.setBehavior(async (args) => {
			args.onSessionId("sid-err");
			args.onError(new Error("API rate limit"));
		});

		await connect();
		await ws.nextMessage(); // consume hello

		ws.send({
			type: "session.create",
			request_id: "req-err",
			prompt: "Trigger error",
			cwd: "/tmp",
		});

		const messages = await ws.collectUntil(
			(msg) => (msg as Record<string, unknown>).type === "error",
		);

		const error = messages.find(
			(m) => (m as Record<string, unknown>).type === "error",
		) as Record<string, unknown>;
		expect(error.code).toBe("prompt_failed");
		expect(error.request_id).toBe("req-err");
		expect(typeof error.message).toBe("string");
		expect((error.message as string)).toContain("API rate limit");
	});
});
