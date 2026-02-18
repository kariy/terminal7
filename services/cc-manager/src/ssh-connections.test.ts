import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	createTestServer,
	destroyTestServer,
	RawWsTestClient,
	type TestContext,
} from "./test-utils";

// ── REST endpoints ──────────────────────────────────────────────

describe("SSH connections REST", () => {
	let ctx: TestContext;

	beforeEach(() => {
		ctx = createTestServer({ withTerminalService: true });
	});

	afterEach(() => {
		destroyTestServer(ctx);
	});

	describe("GET /v1/ssh/connections", () => {
		test("returns empty list initially", async () => {
			const res = await fetch(`${ctx.baseUrl}/v1/ssh/connections`);
			expect(res.status).toBe(200);
			const body = await res.json() as { connections: unknown[] };
			expect(body.connections).toEqual([]);
		});

		test("returns populated list after creating connections", async () => {
			ctx.repository.createSshConnection({ sshDestination: "user@host1" });
			// Small delay to ensure different timestamps
			await new Promise((r) => setTimeout(r, 5));
			ctx.repository.createSshConnection({ sshDestination: "admin@host2", title: "Production" });

			const res = await fetch(`${ctx.baseUrl}/v1/ssh/connections`);
			expect(res.status).toBe(200);
			const body = await res.json() as { connections: Record<string, unknown>[] };
			expect(body.connections.length).toBe(2);

			// Most recently created first (last_connected_at DESC)
			const conn = body.connections[0]!;
			expect(conn.ssh_destination).toBe("admin@host2");
			expect(conn.title).toBe("Production");
			expect(typeof conn.id).toBe("string");
			expect(typeof conn.tmux_session_name).toBe("string");
			expect(typeof conn.created_at).toBe("number");
			expect(typeof conn.last_connected_at).toBe("number");
		});
	});

	describe("POST /v1/ssh/connections", () => {
		test("creates connection with default title", async () => {
			const res = await fetch(`${ctx.baseUrl}/v1/ssh/connections`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ssh_destination: "user@example.com" }),
			});
			expect(res.status).toBe(201);
			const body = await res.json() as { connection: Record<string, unknown> };
			expect(body.connection.ssh_destination).toBe("user@example.com");
			expect(body.connection.title).toBe("user@example.com");
			expect((body.connection.tmux_session_name as string).startsWith("cc-")).toBe(true);
		});

		test("creates connection with custom title", async () => {
			const res = await fetch(`${ctx.baseUrl}/v1/ssh/connections`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ssh_destination: "root@server", title: "My Server" }),
			});
			expect(res.status).toBe(201);
			const body = await res.json() as { connection: Record<string, unknown> };
			expect(body.connection.title).toBe("My Server");
		});

		test("returns 400 when ssh_destination is missing", async () => {
			const res = await fetch(`${ctx.baseUrl}/v1/ssh/connections`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(400);
			const body = await res.json() as { error: { code: string } };
			expect(body.error.code).toBe("invalid_params");
		});

		test("returns 400 for invalid JSON body", async () => {
			const res = await fetch(`${ctx.baseUrl}/v1/ssh/connections`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not json",
			});
			expect(res.status).toBe(400);
			const body = await res.json() as { error: { code: string } };
			expect(body.error.code).toBe("invalid_json");
		});
	});

	describe("DELETE /v1/ssh/connections/:id", () => {
		test("returns 204 when connection exists", async () => {
			const conn = ctx.repository.createSshConnection({ sshDestination: "user@host" });
			const res = await fetch(`${ctx.baseUrl}/v1/ssh/connections/${conn.id}`, {
				method: "DELETE",
			});
			expect(res.status).toBe(204);

			// Verify it's gone
			const listRes = await fetch(`${ctx.baseUrl}/v1/ssh/connections`);
			const body = await listRes.json() as { connections: unknown[] };
			expect(body.connections.length).toBe(0);
		});

		test("returns 404 when connection does not exist", async () => {
			const res = await fetch(`${ctx.baseUrl}/v1/ssh/connections/nonexistent`, {
				method: "DELETE",
			});
			expect(res.status).toBe(404);
			const body = await res.json() as { error: { code: string } };
			expect(body.error.code).toBe("connection_not_found");
		});
	});
});

// ── SSH WebSocket with connection_id ────────────────────────────

describe("SSH WS with connection_id", () => {
	let ctx: TestContext;
	let ws: RawWsTestClient;

	beforeEach(() => {
		ctx = createTestServer({ withTerminalService: true });
	});

	afterEach(() => {
		ws?.close();
		destroyTestServer(ctx);
	});

	function sshUrl(params: Record<string, string>): string {
		const qs = new URLSearchParams(params).toString();
		return `ws://127.0.0.1:${ctx.handle.server.port}/v1/ssh?${qs}`;
	}

	test("connection_id resolves destination and sets tmux remoteCommand", async () => {
		const conn = ctx.repository.createSshConnection({ sshDestination: "user@myserver" });

		ws = new RawWsTestClient(sshUrl({
			connection_id: conn.id,
			cols: "80",
			rows: "24",
		}));
		await ws.connected();

		const openCall = ctx.terminalService!.openCalls[0];
		expect(openCall.sshDestination).toBe("user@myserver");
		// Runs through login shell for proper PATH
		expect(openCall.remoteCommand).toContain("exec $SHELL -lc");
		expect(openCall.remoteCommand).toContain("tmux attach-session -t");
		expect(openCall.remoteCommand).toContain(conn.tmuxSessionName);
		expect(openCall.remoteCommand).toContain("tmux new-session -s");
		expect(openCall.cols).toBe(80);
		expect(openCall.rows).toBe(24);
	});

	test("connection_id updates last_connected_at", async () => {
		const conn = ctx.repository.createSshConnection({ sshDestination: "user@host" });
		const beforeConnect = conn.lastConnectedAt;

		// Small delay to ensure timestamp difference
		await new Promise((r) => setTimeout(r, 10));

		ws = new RawWsTestClient(sshUrl({
			connection_id: conn.id,
			cols: "80",
			rows: "24",
		}));
		await ws.connected();

		const updated = ctx.repository.getSshConnection(conn.id);
		expect(updated!.lastConnectedAt).toBeGreaterThanOrEqual(beforeConnect);
	});

	test("returns 404 for nonexistent connection_id", async () => {
		const res = await fetch(
			`${ctx.baseUrl}/v1/ssh?connection_id=nonexistent&cols=80&rows=24`,
		);
		expect(res.status).toBe(404);
		const body = await res.json() as { error: { code: string } };
		expect(body.error.code).toBe("connection_not_found");
	});

	test("backward compat: ssh_destination without connection_id still works", async () => {
		ws = new RawWsTestClient(sshUrl({
			ssh_destination: "user@legacyhost",
			cols: "80",
			rows: "24",
		}));
		await ws.connected();

		const openCall = ctx.terminalService!.openCalls[0];
		expect(openCall.sshDestination).toBe("user@legacyhost");
		expect(openCall.remoteCommand).toBeUndefined();
	});
});
