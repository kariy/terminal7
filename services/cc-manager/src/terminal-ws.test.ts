import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	createTestServer,
	destroyTestServer,
	RawWsTestClient,
	type TestContext,
} from "./test-utils";

describe("terminal WS", () => {
	let ctx: TestContext;
	let ws: RawWsTestClient;

	beforeEach(() => {
		ctx = createTestServer({
			withTerminalService: true,
		});
	});

	afterEach(() => {
		ws?.close();
		destroyTestServer(ctx);
	});

	function terminalUrl(params?: Record<string, string>): string {
		const defaults = {
			session_id: "test-session",
			encoded_cwd: "-tmp",
			ssh_destination: "user@host",
			cols: "80",
			rows: "24",
		};
		const merged = { ...defaults, ...params };
		const qs = new URLSearchParams(merged).toString();
		return `ws://127.0.0.1:${ctx.handle.server.port}/v1/terminal?${qs}`;
	}

	test("returns 400 when session_id is missing", async () => {
		const res = await fetch(
			`${ctx.baseUrl}/v1/terminal?encoded_cwd=-tmp&ssh_destination=user@host`,
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("invalid_params");
	});

	test("returns 400 when encoded_cwd is missing", async () => {
		const res = await fetch(
			`${ctx.baseUrl}/v1/terminal?session_id=abc&ssh_destination=user@host`,
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("invalid_params");
	});

	test("returns 400 when ssh_destination is missing", async () => {
		const res = await fetch(
			`${ctx.baseUrl}/v1/terminal?session_id=abc&encoded_cwd=-tmp`,
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("invalid_params");
	});

	test("returns 404 when session does not exist", async () => {
		const res = await fetch(
			`${ctx.baseUrl}/v1/terminal?session_id=nonexistent&encoded_cwd=-tmp&ssh_destination=user@host`,
		);
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("session_not_found");
	});

	test("happy path: connect, receive output, send input", async () => {
		// Create a session in the DB first
		ctx.repository.upsertSessionMetadata({
			sessionId: "test-session",
			encodedCwd: "-tmp",
			cwd: "/tmp",
			title: "Test",
			source: "db",
		});

		ws = new RawWsTestClient(terminalUrl());
		await ws.connected();

		// Mock terminal should have been opened
		const handle = ctx.terminalService!.getLastHandle();
		expect(handle).not.toBeNull();
		expect(handle!.closed).toBe(false);

		// Verify SSH command construction
		const openCall = ctx.terminalService!.openCalls[0];
		expect(openCall.sshDestination).toBe("user@host");
		expect(openCall.remoteCommand).toContain("cd '/tmp'");
		expect(openCall.remoteCommand).toContain("claude -r 'test-session'");
		expect(openCall.cols).toBe(80);
		expect(openCall.rows).toBe(24);

		// Simulate output from the PTY
		handle!.simulateOutput("Hello from terminal\r\n");
		const msg = await ws.nextMessage();
		// The message comes as a Buffer from the server, so it arrives as ArrayBuffer
		const text = typeof msg === "string" ? msg : new TextDecoder().decode(msg as ArrayBuffer);
		expect(text).toBe("Hello from terminal\r\n");

		// Send raw input from the client
		ws.send("ls -la\r");

		// Give the server a tick to process
		await new Promise((r) => setTimeout(r, 50));

		expect(handle!.written.length).toBeGreaterThan(0);
		const written = Buffer.concat(handle!.written).toString();
		expect(written).toContain("ls -la\r");
	});

	test("resize control message is forwarded to PTY", async () => {
		ctx.repository.upsertSessionMetadata({
			sessionId: "test-session",
			encodedCwd: "-tmp",
			cwd: "/tmp",
			title: "Test",
			source: "db",
		});

		ws = new RawWsTestClient(terminalUrl());
		await ws.connected();

		const handle = ctx.terminalService!.getLastHandle()!;

		// Send resize message
		ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));

		await new Promise((r) => setTimeout(r, 50));

		expect(handle.resizes).toEqual([{ cols: 120, rows: 40 }]);
		// Resize should not be written to stdin
		expect(handle.written.length).toBe(0);
	});

	test("PTY exit closes the WebSocket", async () => {
		ctx.repository.upsertSessionMetadata({
			sessionId: "test-session",
			encodedCwd: "-tmp",
			cwd: "/tmp",
			title: "Test",
			source: "db",
		});

		ws = new RawWsTestClient(terminalUrl());
		await ws.connected();

		const handle = ctx.terminalService!.getLastHandle()!;

		// Simulate PTY exit
		handle.simulateExit(0);

		// Wait for WS to close
		const closeEvent = await ws.closePromise;
		expect(closeEvent.code).toBe(1000);
	});

	test("WS disconnect kills the PTY", async () => {
		ctx.repository.upsertSessionMetadata({
			sessionId: "test-session",
			encodedCwd: "-tmp",
			cwd: "/tmp",
			title: "Test",
			source: "db",
		});

		ws = new RawWsTestClient(terminalUrl());
		await ws.connected();

		const handle = ctx.terminalService!.getLastHandle()!;
		expect(handle.closed).toBe(false);

		// Close the WS from client side
		ws.close();

		await new Promise((r) => setTimeout(r, 100));

		expect(handle.closed).toBe(true);
	});

	test("passes different ssh_destination values to terminal service", async () => {
		ctx.repository.upsertSessionMetadata({
			sessionId: "test-session",
			encodedCwd: "-tmp",
			cwd: "/tmp",
			title: "Test",
			source: "db",
		});

		ws = new RawWsTestClient(terminalUrl({ ssh_destination: "admin@192.168.1.1" }));
		await ws.connected();

		const openCall = ctx.terminalService!.openCalls[0];
		expect(openCall.sshDestination).toBe("admin@192.168.1.1");
	});
});

describe("direct SSH WS (/v1/ssh)", () => {
	let ctx: TestContext;
	let ws: RawWsTestClient;

	beforeEach(() => {
		ctx = createTestServer({
			withTerminalService: true,
		});
	});

	afterEach(() => {
		ws?.close();
		destroyTestServer(ctx);
	});

	function sshUrl(params?: Record<string, string>): string {
		const defaults = {
			ssh_destination: "user@host",
			cols: "80",
			rows: "24",
		};
		const merged = { ...defaults, ...params };
		const qs = new URLSearchParams(merged).toString();
		return `ws://127.0.0.1:${ctx.handle.server.port}/v1/ssh?${qs}`;
	}

	test("returns 400 when ssh_destination is missing", async () => {
		const res = await fetch(
			`${ctx.baseUrl}/v1/ssh?cols=80&rows=24`,
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("invalid_params");
	});

	test("happy path: connect, receive output, send input", async () => {
		ws = new RawWsTestClient(sshUrl());
		await ws.connected();

		// Mock terminal should have been opened
		const handle = ctx.terminalService!.getLastHandle();
		expect(handle).not.toBeNull();
		expect(handle!.closed).toBe(false);

		// Verify no remoteCommand (login shell)
		const openCall = ctx.terminalService!.openCalls[0];
		expect(openCall.sshDestination).toBe("user@host");
		expect(openCall.remoteCommand).toBeUndefined();
		expect(openCall.cols).toBe(80);
		expect(openCall.rows).toBe(24);

		// Simulate output from the PTY
		handle!.simulateOutput("Welcome to SSH\r\n");
		const msg = await ws.nextMessage();
		const text = typeof msg === "string" ? msg : new TextDecoder().decode(msg as ArrayBuffer);
		expect(text).toBe("Welcome to SSH\r\n");

		// Send raw input from the client
		ws.send("whoami\r");

		await new Promise((r) => setTimeout(r, 50));

		expect(handle!.written.length).toBeGreaterThan(0);
		const written = Buffer.concat(handle!.written).toString();
		expect(written).toContain("whoami\r");
	});

	test("resize control message works", async () => {
		ws = new RawWsTestClient(sshUrl());
		await ws.connected();

		const handle = ctx.terminalService!.getLastHandle()!;

		ws.send(JSON.stringify({ type: "resize", cols: 100, rows: 50 }));

		await new Promise((r) => setTimeout(r, 50));

		expect(handle.resizes).toEqual([{ cols: 100, rows: 50 }]);
		expect(handle.written.length).toBe(0);
	});

	test("WS disconnect kills the PTY", async () => {
		ws = new RawWsTestClient(sshUrl());
		await ws.connected();

		const handle = ctx.terminalService!.getLastHandle()!;
		expect(handle.closed).toBe(false);

		ws.close();

		await new Promise((r) => setTimeout(r, 100));

		expect(handle.closed).toBe(true);
	});

	test("passes ssh_password to terminal service", async () => {
		ws = new RawWsTestClient(sshUrl({ ssh_password: "secret123" }));
		await ws.connected();

		const openCall = ctx.terminalService!.openCalls[0];
		expect(openCall.sshPassword).toBe("secret123");
	});
});
