import { describe, test, expect, afterEach, beforeAll, afterAll } from "bun:test";
import {
	createTestServer,
	destroyTestServer,
	WsTestClient,
	type TestContext,
} from "./test-utils";
import { hashPassword, validatePassword } from "./auth";
import { nowMs } from "./utils";

describe("Authentication", () => {
	let ctx: TestContext;

	afterEach(() => {
		if (ctx) destroyTestServer(ctx);
	});

	describe("auth disabled (no token, no users)", () => {
		test("requests pass without token", async () => {
			ctx = createTestServer();
			const res = await fetch(`${ctx.baseUrl}/v1/sessions`);
			expect(res.status).toBe(200);
		});

		test("/health returns 200", async () => {
			ctx = createTestServer();
			const res = await fetch(`${ctx.baseUrl}/health`);
			expect(res.status).toBe(200);
		});

		test("WebSocket connects without token", async () => {
			ctx = createTestServer();
			const ws = new WsTestClient(ctx.wsUrl);
			await ws.connected();
			const hello = (await ws.nextMessage()) as any;
			expect(hello.type).toBe("hello");
			expect(hello.requires_auth).toBe(false);
			ws.close();
		});
	});

	describe("bearer token auth", () => {
		const AUTH_TOKEN = "test-secret-token-123";

		test("returns 401 on /v1/* without token", async () => {
			ctx = createTestServer({ authToken: AUTH_TOKEN });
			const res = await fetch(`${ctx.baseUrl}/v1/sessions`);
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.error.code).toBe("unauthorized");
		});

		test("returns 401 with invalid token", async () => {
			ctx = createTestServer({ authToken: AUTH_TOKEN });
			const res = await fetch(`${ctx.baseUrl}/v1/sessions`, {
				headers: { Authorization: "Bearer wrong-token" },
			});
			expect(res.status).toBe(401);
		});

		test("returns 200 with valid Bearer token", async () => {
			ctx = createTestServer({ authToken: AUTH_TOKEN });
			const res = await fetch(`${ctx.baseUrl}/v1/sessions`, {
				headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			});
			expect(res.status).toBe(200);
		});

		test("returns 200 with valid query param token", async () => {
			ctx = createTestServer({ authToken: AUTH_TOKEN });
			const res = await fetch(
				`${ctx.baseUrl}/v1/sessions?token=${AUTH_TOKEN}`,
			);
			expect(res.status).toBe(200);
		});

		test("/health always returns 200 (exempt)", async () => {
			ctx = createTestServer({ authToken: AUTH_TOKEN });
			const res = await fetch(`${ctx.baseUrl}/health`);
			expect(res.status).toBe(200);
		});

		test("WebSocket returns 401 without token", async () => {
			ctx = createTestServer({ authToken: AUTH_TOKEN });
			const res = await fetch(`${ctx.baseUrl}/v1/ws`, {
				headers: { Upgrade: "websocket", Connection: "Upgrade" },
			});
			expect(res.status).toBe(401);
		});

		test("WebSocket connects with valid query param token", async () => {
			ctx = createTestServer({ authToken: AUTH_TOKEN });
			const ws = new WsTestClient(`${ctx.wsUrl}?token=${AUTH_TOKEN}`);
			await ws.connected();
			const hello = (await ws.nextMessage()) as any;
			expect(hello.type).toBe("hello");
			expect(hello.requires_auth).toBe(true);
			ws.close();
		});

		test("GET /v1/auth/me returns user info with valid token", async () => {
			ctx = createTestServer({ authToken: AUTH_TOKEN });
			const res = await fetch(`${ctx.baseUrl}/v1/auth/me`, {
				headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.auth_method).toBe("bearer_token");
		});
	});

	describe("user/password auth", () => {
		async function createCtxWithUser() {
			const c = createTestServer();
			const passwordHash = await hashPassword("testpass123");
			c.repository.createAuthUser({
				id: crypto.randomUUID(),
				username: "testuser",
				passwordHash,
			});
			return c;
		}

		test("requires_auth is true when users exist", async () => {
			ctx = await createCtxWithUser();
			// Login to get a session cookie, then connect WS with it
			const loginRes = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: "testuser", password: "testpass123" }),
			});
			const setCookie = loginRes.headers.get("set-cookie")!;
			const sessionId = setCookie.split(";")[0].split("=").slice(1).join("=");

			const ws = new WsTestClient(`${ctx.wsUrl}?token=${sessionId}`);
			await ws.connected();
			const hello = (await ws.nextMessage()) as any;
			expect(hello.type).toBe("hello");
			expect(hello.requires_auth).toBe(true);
			ws.close();
		});

		test("returns 401 on /v1/* without auth", async () => {
			ctx = await createCtxWithUser();
			const res = await fetch(`${ctx.baseUrl}/v1/sessions`);
			expect(res.status).toBe(401);
		});

		test("login with valid credentials sets session cookie", async () => {
			ctx = await createCtxWithUser();
			const res = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "testuser",
					password: "testpass123",
				}),
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.user.username).toBe("testuser");
			const setCookie = res.headers.get("set-cookie");
			expect(setCookie).toBeTruthy();
			expect(setCookie).toContain("cc_session=");
			expect(setCookie).toContain("HttpOnly");
		});

		test("login with invalid password returns 401", async () => {
			ctx = await createCtxWithUser();
			const res = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "testuser",
					password: "wrongpass",
				}),
			});
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.error.code).toBe("invalid_credentials");
		});

		test("login with nonexistent user returns 401", async () => {
			ctx = await createCtxWithUser();
			const res = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "nobody",
					password: "testpass123",
				}),
			});
			expect(res.status).toBe(401);
		});

		test("session cookie grants access to /v1/*", async () => {
			ctx = await createCtxWithUser();
			const loginRes = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "testuser",
					password: "testpass123",
				}),
			});
			const setCookie = loginRes.headers.get("set-cookie")!;
			const cookieValue = setCookie.split(";")[0]; // "cc_session=<id>"

			const res = await fetch(`${ctx.baseUrl}/v1/sessions`, {
				headers: { Cookie: cookieValue },
			});
			expect(res.status).toBe(200);
		});

		test("session cookie works for WebSocket via query param", async () => {
			ctx = await createCtxWithUser();
			const loginRes = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "testuser",
					password: "testpass123",
				}),
			});
			const setCookie = loginRes.headers.get("set-cookie")!;
			const sessionId = setCookie
				.split(";")[0]
				.split("=")
				.slice(1)
				.join("=");

			const ws = new WsTestClient(
				`${ctx.wsUrl}?token=${sessionId}`,
			);
			await ws.connected();
			const hello = (await ws.nextMessage()) as any;
			expect(hello.type).toBe("hello");
			ws.close();
		});

		test("GET /v1/auth/me returns user info with session cookie", async () => {
			ctx = await createCtxWithUser();
			const loginRes = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "testuser",
					password: "testpass123",
				}),
			});
			const setCookie = loginRes.headers.get("set-cookie")!;
			const cookieValue = setCookie.split(";")[0];

			const res = await fetch(`${ctx.baseUrl}/v1/auth/me`, {
				headers: { Cookie: cookieValue },
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.user.username).toBe("testuser");
			expect(body.auth_method).toBe("session");
		});

		test("logout invalidates session", async () => {
			ctx = await createCtxWithUser();
			const loginRes = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "testuser",
					password: "testpass123",
				}),
			});
			const setCookie = loginRes.headers.get("set-cookie")!;
			const cookieValue = setCookie.split(";")[0];

			// Logout
			await fetch(`${ctx.baseUrl}/v1/auth/logout`, {
				method: "POST",
				headers: { Cookie: cookieValue },
			});

			// Session should be invalid now
			const res = await fetch(`${ctx.baseUrl}/v1/sessions`, {
				headers: { Cookie: cookieValue },
			});
			expect(res.status).toBe(401);
		});

		test("login endpoint is accessible without auth", async () => {
			ctx = await createCtxWithUser();
			// Login endpoint should not require auth
			const res = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "testuser",
					password: "testpass123",
				}),
			});
			expect(res.status).toBe(200);
		});

		test("login with missing fields returns 400", async () => {
			ctx = await createCtxWithUser();
			const res = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: "testuser" }),
			});
			expect(res.status).toBe(400);
		});
	});

	describe("registration", () => {
		test("creates user and returns 200 with Set-Cookie", async () => {
			ctx = createTestServer();
			const res = await fetch(`${ctx.baseUrl}/v1/auth/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "newuser",
					password: "password123",
				}),
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.user.username).toBe("newuser");
			const setCookie = res.headers.get("set-cookie");
			expect(setCookie).toBeTruthy();
			expect(setCookie).toContain("cc_session=");
		});

		test("rejects duplicate username with 409", async () => {
			ctx = createTestServer();
			// First registration
			await fetch(`${ctx.baseUrl}/v1/auth/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "newuser",
					password: "password123",
				}),
			});
			// Duplicate
			const res = await fetch(`${ctx.baseUrl}/v1/auth/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "newuser",
					password: "password456",
				}),
			});
			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.error.code).toBe("username_taken");
		});

		test("rejects empty password with 400", async () => {
			ctx = createTestServer();
			const res = await fetch(`${ctx.baseUrl}/v1/auth/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "newuser",
					password: "",
				}),
			});
			expect(res.status).toBe(400);
		});

		test("rate-limited after too many attempts", async () => {
			ctx = createTestServer({
				rateLimitWindowMs: 60_000,
				rateLimitMaxAttempts: 2,
			});
			// Exhaust rate limit with failed logins
			for (let i = 0; i < 2; i++) {
				await fetch(`${ctx.baseUrl}/v1/auth/login`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ username: "nobody", password: "wrong123" }),
				});
			}
			const res = await fetch(`${ctx.baseUrl}/v1/auth/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "newuser",
					password: "password123",
				}),
			});
			expect(res.status).toBe(429);
		});

		test("register endpoint is accessible without auth", async () => {
			ctx = createTestServer();
			// Create a user so auth is enabled
			const passwordHash = await hashPassword("testpass123");
			ctx.repository.createAuthUser({
				id: crypto.randomUUID(),
				username: "existing",
				passwordHash,
			});
			// Register should still be accessible (exempt route)
			const res = await fetch(`${ctx.baseUrl}/v1/auth/register`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "newuser2",
					password: "password123",
				}),
			});
			expect(res.status).toBe(200);
		});
	});

	describe("auth status", () => {
		test("needs_setup is true when no users and no token", async () => {
			ctx = createTestServer();
			const res = await fetch(`${ctx.baseUrl}/v1/auth/status`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.needs_setup).toBe(true);
			expect(body.auth_enabled).toBe(false);
			expect(body.google_enabled).toBe(false);
		});

		test("needs_setup is false after user exists", async () => {
			ctx = createTestServer();
			const passwordHash = await hashPassword("testpass123");
			ctx.repository.createAuthUser({
				id: crypto.randomUUID(),
				username: "admin",
				passwordHash,
			});
			const res = await fetch(`${ctx.baseUrl}/v1/auth/status`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.needs_setup).toBe(false);
			expect(body.auth_enabled).toBe(true);
		});

		test("needs_setup is false when bearer token is set", async () => {
			ctx = createTestServer({ authToken: "some-token" });
			const res = await fetch(`${ctx.baseUrl}/v1/auth/status`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.needs_setup).toBe(false);
			expect(body.auth_enabled).toBe(true);
		});

		test("google_enabled reflects config", async () => {
			ctx = createTestServer({ googleClientId: "test-client-id.apps.googleusercontent.com" });
			const res = await fetch(`${ctx.baseUrl}/v1/auth/status`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.google_enabled).toBe(true);
		});

		test("auth status is accessible without auth", async () => {
			ctx = createTestServer({ authToken: "secret" });
			// Should be accessible even without providing the token
			const res = await fetch(`${ctx.baseUrl}/v1/auth/status`);
			expect(res.status).toBe(200);
		});
	});

	describe("google login", () => {
		test("rejects when google not configured with 400", async () => {
			ctx = createTestServer();
			const res = await fetch(`${ctx.baseUrl}/v1/auth/google`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id_token: "fake-token" }),
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("google_not_configured");
		});

		test("rejects missing id_token with 400", async () => {
			ctx = createTestServer({ googleClientId: "test-client-id" });
			const res = await fetch(`${ctx.baseUrl}/v1/auth/google`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("invalid_params");
		});

		test("google endpoint is accessible without auth", async () => {
			ctx = createTestServer({ authToken: "secret" });
			const res = await fetch(`${ctx.baseUrl}/v1/auth/google`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id_token: "fake" }),
			});
			// Should not be 401 — it's exempt from auth gate
			// Will be 400 because google is not configured
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("google_not_configured");
		});
	});

	describe("rate limiting", () => {
		async function createCtxWithUserAndLowLimit() {
			const c = createTestServer({
				rateLimitWindowMs: 60_000,
				rateLimitMaxAttempts: 3,
			});
			const passwordHash = await hashPassword("testpass123");
			c.repository.createAuthUser({
				id: crypto.randomUUID(),
				username: "testuser",
				passwordHash,
			});
			return c;
		}

		test("returns 429 after too many failed attempts", async () => {
			ctx = await createCtxWithUserAndLowLimit();
			for (let i = 0; i < 3; i++) {
				await fetch(`${ctx.baseUrl}/v1/auth/login`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ username: "testuser", password: "wrong" }),
				});
			}
			const res = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: "testuser", password: "testpass123" }),
			});
			expect(res.status).toBe(429);
			const body = await res.json();
			expect(body.error.code).toBe("rate_limited");
			expect(res.headers.get("retry-after")).toBeTruthy();
		});

		test("resets on successful login", async () => {
			ctx = await createCtxWithUserAndLowLimit();
			// 2 failures
			for (let i = 0; i < 2; i++) {
				await fetch(`${ctx.baseUrl}/v1/auth/login`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ username: "testuser", password: "wrong" }),
				});
			}
			// Successful login resets the counter
			const loginRes = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: "testuser", password: "testpass123" }),
			});
			expect(loginRes.status).toBe(200);
			// Should be able to fail again without hitting limit
			const res = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: "testuser", password: "wrong" }),
			});
			expect(res.status).toBe(401);
		});
	});

	describe("cookie Secure flag", () => {
		test("Secure flag present when X-Forwarded-Proto is https", async () => {
			ctx = createTestServer({ cookieSecure: "auto" as const });
			const passwordHash = await hashPassword("testpass123");
			ctx.repository.createAuthUser({
				id: crypto.randomUUID(),
				username: "testuser",
				passwordHash,
			});
			const res = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Forwarded-Proto": "https",
				},
				body: JSON.stringify({ username: "testuser", password: "testpass123" }),
			});
			expect(res.status).toBe(200);
			const setCookie = res.headers.get("set-cookie")!;
			expect(setCookie).toContain("Secure");
		});

		test("Secure flag absent for plain HTTP without forwarded header", async () => {
			ctx = createTestServer({ cookieSecure: "auto" as const });
			const passwordHash = await hashPassword("testpass123");
			ctx.repository.createAuthUser({
				id: crypto.randomUUID(),
				username: "testuser",
				passwordHash,
			});
			const res = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ username: "testuser", password: "testpass123" }),
			});
			expect(res.status).toBe(200);
			const setCookie = res.headers.get("set-cookie")!;
			expect(setCookie).not.toContain("Secure");
		});
	});

	describe("password validation", () => {
		test("rejects empty password", () => {
			expect(validatePassword("").valid).toBe(false);
			expect(validatePassword("").message).toBeTruthy();
		});

		test("accepts any non-empty password", () => {
			expect(validatePassword("a").valid).toBe(true);
			expect(validatePassword("admin").valid).toBe(true);
		});
	});

	describe("discord linking", () => {
		let dctx: TestContext;
		let sessionCookie: string;
		let testUserId: string;

		beforeAll(async () => {
			dctx = createTestServer();
			testUserId = crypto.randomUUID();
			const passwordHash = await hashPassword("testpass123");
			dctx.repository.createAuthUser({
				id: testUserId,
				username: "testuser",
				passwordHash,
			});
			const loginRes = await fetch(`${dctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ username: "testuser", password: "testpass123" }),
			});
			const setCookie = loginRes.headers.get("set-cookie") ?? "";
			const match = setCookie.match(/cc_session=([^;]+)/);
			sessionCookie = match ? match[1] : "";
		});

		afterAll(() => {
			destroyTestServer(dctx);
		});

		test("POST confirms link with valid code", async () => {
			const code = crypto.randomUUID();
			dctx.repository.createDiscordLinkCode({
				code,
				discordUserId: "discord-123",
				discordUsername: "testdiscord",
				expiresAt: nowMs() + 600_000,
			});

			const res = await fetch(`${dctx.baseUrl}/v1/auth/discord/link`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					cookie: `cc_session=${sessionCookie}`,
				},
				body: JSON.stringify({ code }),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.ok).toBe(true);
			expect(body.discord_username).toBe("testdiscord");

			const link = dctx.repository.getDiscordUserLink("discord-123");
			expect(link).not.toBeNull();
			expect(link!.authUserId).toBe(testUserId);

			expect(dctx.repository.getDiscordLinkCode(code)).toBeNull();
		});

		test("POST rejects expired code", async () => {
			const code = crypto.randomUUID();
			dctx.repository.createDiscordLinkCode({
				code,
				discordUserId: "discord-456",
				discordUsername: "expireduser",
				expiresAt: nowMs() - 1000,
			});

			const res = await fetch(`${dctx.baseUrl}/v1/auth/discord/link`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					cookie: `cc_session=${sessionCookie}`,
				},
				body: JSON.stringify({ code }),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("code_expired");
		});

		test("POST rejects invalid code", async () => {
			const res = await fetch(`${dctx.baseUrl}/v1/auth/discord/link`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					cookie: `cc_session=${sessionCookie}`,
				},
				body: JSON.stringify({ code: "nonexistent-code" }),
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("code_not_found");
		});

		test("POST requires auth", async () => {
			const code = crypto.randomUUID();
			dctx.repository.createDiscordLinkCode({
				code,
				discordUserId: "discord-789",
				discordUsername: "noauthuser",
				expiresAt: nowMs() + 600_000,
			});

			const res = await fetch(`${dctx.baseUrl}/v1/auth/discord/link`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code }),
			});

			expect(res.status).toBe(401);
		});

		test("GET shows confirmation when logged in", async () => {
			const code = crypto.randomUUID();
			dctx.repository.createDiscordLinkCode({
				code,
				discordUserId: "discord-page-1",
				discordUsername: "pageuser",
				expiresAt: nowMs() + 600_000,
			});

			const res = await fetch(
				`${dctx.baseUrl}/v1/auth/discord/link?code=${code}`,
				{ headers: { cookie: `cc_session=${sessionCookie}` } },
			);

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("pageuser");
			expect(html).toContain("Confirm Link");
		});

		test("GET shows login prompt when not logged in", async () => {
			const code = crypto.randomUUID();
			dctx.repository.createDiscordLinkCode({
				code,
				discordUserId: "discord-page-2",
				discordUsername: "nologinuser",
				expiresAt: nowMs() + 600_000,
			});

			const res = await fetch(
				`${dctx.baseUrl}/v1/auth/discord/link?code=${code}`,
			);

			expect(res.status).toBe(401);
			const html = await res.text();
			expect(html).toContain("Log in");
		});

		test("GET returns 404 for invalid code", async () => {
			const res = await fetch(
				`${dctx.baseUrl}/v1/auth/discord/link?code=bogus`,
			);
			expect(res.status).toBe(404);
		});

		test("repository discord user link CRUD", () => {
			dctx.repository.createDiscordUserLink({
				discordUserId: "crud-test-1",
				authUserId: testUserId,
			});

			const link = dctx.repository.getDiscordUserLink("crud-test-1");
			expect(link).not.toBeNull();
			expect(link!.authUserId).toBe(testUserId);

			expect(dctx.repository.deleteDiscordUserLink("crud-test-1")).toBe(true);
			expect(dctx.repository.getDiscordUserLink("crud-test-1")).toBeNull();
			expect(dctx.repository.deleteDiscordUserLink("crud-test-1")).toBe(false);
		});

		test("expired link codes are cleaned up", () => {
			dctx.repository.createDiscordLinkCode({
				code: "expired-1",
				discordUserId: "d-1",
				discordUsername: "u-1",
				expiresAt: nowMs() - 1000,
			});
			dctx.repository.createDiscordLinkCode({
				code: "valid-1",
				discordUserId: "d-2",
				discordUsername: "u-2",
				expiresAt: nowMs() + 600_000,
			});

			const cleaned = dctx.repository.deleteExpiredDiscordLinkCodes();
			expect(cleaned).toBeGreaterThanOrEqual(1);
			expect(dctx.repository.getDiscordLinkCode("expired-1")).toBeNull();
			expect(dctx.repository.getDiscordLinkCode("valid-1")).not.toBeNull();
		});
	});

	describe("mixed auth (token + users)", () => {
		test("both bearer token and cookie auth work", async () => {
			const AUTH_TOKEN = "mixed-token";
			ctx = createTestServer({ authToken: AUTH_TOKEN });
			const passwordHash = await hashPassword("pass123");
			ctx.repository.createAuthUser({
				id: crypto.randomUUID(),
				username: "admin",
				passwordHash,
			});

			// Bearer token works
			const res1 = await fetch(`${ctx.baseUrl}/v1/sessions`, {
				headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
			});
			expect(res1.status).toBe(200);

			// Cookie auth works
			const loginRes = await fetch(`${ctx.baseUrl}/v1/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "admin",
					password: "pass123",
				}),
			});
			expect(loginRes.status).toBe(200);
			const setCookie = loginRes.headers.get("set-cookie")!;
			const cookieValue = setCookie.split(";")[0];

			const res2 = await fetch(`${ctx.baseUrl}/v1/sessions`, {
				headers: { Cookie: cookieValue },
			});
			expect(res2.status).toBe(200);
		});
	});
});
