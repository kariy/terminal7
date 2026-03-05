import { timingSafeEqual as cryptoTimingSafeEqual } from "crypto";
import type { ManagerConfig } from "./config";
import type { ManagerRepository } from "./repository";
import type { LoginRateLimiter } from "./rate-limiter";
import type { AuthUser } from "./types";
import { jsonResponse } from "./http-utils";
import { log } from "./logger";
import { nowMs } from "./utils";

const SESSION_COOKIE_NAME = "cc_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthDeps {
	repository: ManagerRepository;
	config: ManagerConfig;
	rateLimiter?: LoginRateLimiter;
	serverInstance?: { requestIP(req: Request): { address: string } | null };
}

/**
 * Build a Set-Cookie header string with conditional Secure flag.
 */
function buildSetCookieHeader(
	name: string,
	value: string,
	maxAge: number,
	req: Request,
	config: ManagerConfig,
): string {
	let secure = false;
	if (config.cookieSecure === "always") {
		secure = true;
	} else if (config.cookieSecure === "auto") {
		const fwdProto = req.headers.get("x-forwarded-proto");
		if (fwdProto === "https" || new URL(req.url).protocol === "https:") {
			secure = true;
		}
	}
	const parts = [
		`${name}=${value}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Strict",
		`Max-Age=${maxAge}`,
	];
	if (secure) parts.push("Secure");
	return parts.join("; ");
}

/**
 * Create a session response with cookie for an authenticated user.
 */
function createSessionResponse(
	user: AuthUser,
	req: Request,
	deps: AuthDeps,
): Response {
	const sessionId = crypto.randomUUID();
	const expiresAt = nowMs() + SESSION_MAX_AGE_MS;
	deps.repository.createAuthSession({
		id: sessionId,
		userId: user.id,
		expiresAt,
	});
	deps.repository.deleteExpiredAuthSessions();
	const maxAgeSecs = Math.floor(SESSION_MAX_AGE_MS / 1000);
	return jsonResponse(
		200,
		{
			user: { username: user.username },
			session: { expires_at: expiresAt },
		},
		{
			"Set-Cookie": buildSetCookieHeader(SESSION_COOKIE_NAME, sessionId, maxAgeSecs, req, deps.config),
		},
	);
}

/**
 * Extract client IP from request, respecting trustProxy config.
 */
export function getClientIp(
	req: Request,
	config: ManagerConfig,
	server?: { requestIP(req: Request): { address: string } | null },
): string {
	if (config.trustProxy) {
		const forwarded = req.headers.get("x-forwarded-for");
		if (forwarded) {
			const first = forwarded.split(",")[0].trim();
			if (first) return first;
		}
	}
	if (server) {
		const ip = server.requestIP(req);
		if (ip) return ip.address;
	}
	return "unknown";
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	const maxLen = Math.max(bufA.byteLength, bufB.byteLength);
	if (maxLen === 0) return bufA.byteLength === bufB.byteLength;
	const paddedA = Buffer.alloc(maxLen);
	const paddedB = Buffer.alloc(maxLen);
	bufA.copy(paddedA);
	bufB.copy(paddedB);
	return cryptoTimingSafeEqual(paddedA, paddedB) && bufA.byteLength === bufB.byteLength;
}

/**
 * Hash a password using Bun's built-in bcrypt-compatible password hashing.
 */
export async function hashPassword(password: string): Promise<string> {
	return Bun.password.hash(password);
}

/**
 * Verify a password against a hash.
 */
export async function verifyPassword(
	password: string,
	hash: string,
): Promise<boolean> {
	return Bun.password.verify(password, hash);
}

/**
 * Extract session ID from the cookie header.
 */
function getSessionCookie(req: Request): string | null {
	const cookie = req.headers.get("cookie");
	if (!cookie) return null;
	const match = cookie.match(
		new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`),
	);
	return match ? match[1] : null;
}

let authEnabledCache: { value: boolean; ts: number } | null = null;
const AUTH_CACHE_TTL_MS = 30_000;

/**
 * Check if any auth mechanism is enabled (users exist or static token is set).
 * Result is cached for 30 seconds to avoid repeated DB queries.
 */
export function isAuthEnabled(
	config: ManagerConfig,
	repository: ManagerRepository,
): boolean {
	if (config.authToken) return true;
	const now = Date.now();
	if (authEnabledCache && now - authEnabledCache.ts < AUTH_CACHE_TTL_MS) {
		return authEnabledCache.value;
	}
	const users = repository.listAuthUsers();
	const value = users.length > 0;
	authEnabledCache = { value, ts: now };
	return value;
}

/**
 * Invalidate the isAuthEnabled cache (e.g. after user creation/deletion).
 */
export function invalidateAuthCache(): void {
	authEnabledCache = null;
}

/**
 * Validates the request against all supported auth methods:
 * 1. Bearer token (static CC_MANAGER_AUTH_TOKEN)
 * 2. Session cookie (user login)
 * 3. Query param token (for WebSocket from browsers)
 *
 * Returns true if auth is disabled (no token configured and no users) or auth is valid.
 */
export function validateAuth(
	req: Request,
	config: ManagerConfig,
	repository: ManagerRepository,
): boolean {
	if (!isAuthEnabled(config, repository)) return true;

	// Check Bearer token (static)
	if (config.authToken) {
		const authHeader = req.headers.get("authorization");
		if (authHeader) {
			const match = authHeader.match(/^Bearer\s+(.+)$/i);
			if (match && timingSafeEqual(match[1], config.authToken)) {
				return true;
			}
		}
	}

	// Check session cookie
	const sessionId = getSessionCookie(req);
	if (sessionId) {
		const session = repository.getAuthSession(sessionId);
		if (session && session.expiresAt > nowMs()) {
			return true;
		}
	}

	// Check query param token (for WebSocket connections from browsers)
	const url = new URL(req.url);
	const tokenParam = url.searchParams.get("token");
	if (tokenParam) {
		// Check against static token
		if (config.authToken && timingSafeEqual(tokenParam, config.authToken)) {
			return true;
		}
		// Check against session ID
		const session = repository.getAuthSession(tokenParam);
		if (session && session.expiresAt > nowMs()) {
			return true;
		}
	}

	return false;
}

/**
 * Check rate limit and return error response if limited, or null if allowed.
 */
function checkRateLimit(ip: string, deps: AuthDeps): Response | null {
	if (!deps.rateLimiter) return null;
	const check = deps.rateLimiter.check(ip);
	if (!check.allowed) {
		log.auth(`rate_limited ip=${ip}`);
		const retryAfterSecs = Math.ceil((check.retryAfterMs ?? 0) / 1000);
		return jsonResponse(
			429,
			{
				error: {
					code: "rate_limited",
					message: "Too many attempts. Try again later.",
				},
			},
			{ "Retry-After": String(retryAfterSecs) },
		);
	}
	return null;
}

/**
 * Handle GET /v1/auth/status — public endpoint for auth state discovery.
 */
export function handleAuthStatus(
	_req: Request,
	deps: AuthDeps,
): Response {
	const { config, repository } = deps;
	const hasUsers = repository.listAuthUsers().length > 0;
	const hasToken = !!config.authToken;
	const needsSetup = !hasUsers && !hasToken;
	const googleEnabled = !!config.googleClientId;

	return jsonResponse(200, {
		auth_enabled: hasUsers || hasToken,
		needs_setup: needsSetup,
		google_enabled: googleEnabled,
	});
}

/**
 * Handle POST /v1/auth/login
 */
export async function handleLogin(
	req: Request,
	deps: AuthDeps,
): Promise<Response> {
	const ip = getClientIp(req, deps.config, deps.serverInstance);

	const rateLimited = checkRateLimit(ip, deps);
	if (rateLimited) return rateLimited;

	let body: { username?: string; password?: string };
	try {
		body = await req.json();
	} catch {
		return jsonResponse(400, {
			error: { code: "invalid_json", message: "Invalid JSON body" },
		});
	}

	const username = body.username?.trim();
	const password = body.password;

	if (!username || !password) {
		return jsonResponse(400, {
			error: {
				code: "invalid_params",
				message: "username and password are required",
			},
		});
	}

	const user = deps.repository.getAuthUserByUsername(username);
	if (!user) {
		// Still hash to prevent timing attacks on username enumeration
		await Bun.password.hash("dummy");
		deps.rateLimiter?.recordFailure(ip);
		log.auth(`login_failed username=${username} ip=${ip}`);
		return jsonResponse(401, {
			error: {
				code: "invalid_credentials",
				message: "Invalid username or password",
			},
		});
	}

	const valid = await verifyPassword(password, user.passwordHash);
	if (!valid) {
		deps.rateLimiter?.recordFailure(ip);
		log.auth(`login_failed username=${username} ip=${ip}`);
		return jsonResponse(401, {
			error: {
				code: "invalid_credentials",
				message: "Invalid username or password",
			},
		});
	}

	deps.rateLimiter?.reset(ip);
	log.auth(`login_success username=${username} ip=${ip}`);
	return createSessionResponse(user, req, deps);
}

/**
 * Handle POST /v1/auth/register
 */
export async function handleRegister(
	req: Request,
	deps: AuthDeps,
): Promise<Response> {
	const ip = getClientIp(req, deps.config, deps.serverInstance);

	const rateLimited = checkRateLimit(ip, deps);
	if (rateLimited) return rateLimited;

	let body: { username?: string; password?: string };
	try {
		body = await req.json();
	} catch {
		return jsonResponse(400, {
			error: { code: "invalid_json", message: "Invalid JSON body" },
		});
	}

	const username = body.username?.trim();
	const password = body.password;

	if (!username || !password) {
		return jsonResponse(400, {
			error: {
				code: "invalid_params",
				message: "username and password are required",
			},
		});
	}

	if (username.length < 2) {
		return jsonResponse(400, {
			error: {
				code: "invalid_params",
				message: "Username must be at least 2 characters",
			},
		});
	}

	const pwCheck = validatePassword(password);
	if (!pwCheck.valid) {
		return jsonResponse(400, {
			error: {
				code: "invalid_params",
				message: pwCheck.message!,
			},
		});
	}

	const existing = deps.repository.getAuthUserByUsername(username);
	if (existing) {
		return jsonResponse(409, {
			error: {
				code: "username_taken",
				message: "Username is already taken",
			},
		});
	}

	const passwordHash = await hashPassword(password);
	const user = deps.repository.createAuthUser({
		id: crypto.randomUUID(),
		username,
		passwordHash,
	});

	invalidateAuthCache();
	log.auth(`register_success username=${username} ip=${ip}`);
	return createSessionResponse(user, req, deps);
}

/**
 * Handle POST /v1/auth/google
 */
export async function handleGoogleLogin(
	req: Request,
	deps: AuthDeps,
): Promise<Response> {
	const { config, repository } = deps;
	const ip = getClientIp(req, config, deps.serverInstance);

	if (!config.googleClientId) {
		return jsonResponse(400, {
			error: {
				code: "google_not_configured",
				message: "Google login is not configured on this server",
			},
		});
	}

	const rateLimited = checkRateLimit(ip, deps);
	if (rateLimited) return rateLimited;

	let body: { id_token?: string };
	try {
		body = await req.json();
	} catch {
		return jsonResponse(400, {
			error: { code: "invalid_json", message: "Invalid JSON body" },
		});
	}

	const idToken = body.id_token;
	if (!idToken) {
		return jsonResponse(400, {
			error: {
				code: "invalid_params",
				message: "id_token is required",
			},
		});
	}

	// Verify the token with Google
	let tokenInfo: { aud?: string; email?: string; email_verified?: string };
	try {
		const verifyRes = await fetch(
			`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
		);
		if (!verifyRes.ok) {
			deps.rateLimiter?.recordFailure(ip);
			log.auth(`google_login_failed invalid_token ip=${ip}`);
			return jsonResponse(401, {
				error: {
					code: "invalid_google_token",
					message: "Google token verification failed",
				},
			});
		}
		tokenInfo = await verifyRes.json();
	} catch {
		return jsonResponse(502, {
			error: {
				code: "google_verify_error",
				message: "Failed to verify Google token",
			},
		});
	}

	// Validate audience matches our client ID
	if (tokenInfo.aud !== config.googleClientId) {
		deps.rateLimiter?.recordFailure(ip);
		log.auth(`google_login_failed aud_mismatch ip=${ip}`);
		return jsonResponse(401, {
			error: {
				code: "invalid_google_token",
				message: "Google token audience mismatch",
			},
		});
	}

	if (tokenInfo.email_verified !== "true" || !tokenInfo.email) {
		return jsonResponse(401, {
			error: {
				code: "invalid_google_token",
				message: "Email not verified",
			},
		});
	}

	const email = tokenInfo.email;

	// Find or create user by email
	let user = repository.getAuthUserByUsername(email);
	if (!user) {
		const randomHash = await hashPassword(crypto.randomUUID());
		user = repository.createAuthUser({
			id: crypto.randomUUID(),
			username: email,
			passwordHash: randomHash,
		});
		invalidateAuthCache();
		log.auth(`google_register username=${email} ip=${ip}`);
	} else {
		log.auth(`google_login username=${email} ip=${ip}`);
	}

	deps.rateLimiter?.reset(ip);
	return createSessionResponse(user, req, deps);
}

/**
 * Handle POST /v1/auth/logout
 */
export function handleLogout(
	req: Request,
	deps: AuthDeps,
): Response {
	const sessionId = getSessionCookie(req);
	if (sessionId) {
		deps.repository.deleteAuthSession(sessionId);
	}

	log.auth("logout");

	return jsonResponse(
		200,
		{ ok: true },
		{
			"Set-Cookie": buildSetCookieHeader(SESSION_COOKIE_NAME, "", 0, req, deps.config),
		},
	);
}

/**
 * Handle GET /v1/auth/me
 */
export function handleAuthMe(
	req: Request,
	deps: AuthDeps,
): Response {
	const { config, repository } = deps;

	// Check Bearer token
	if (config.authToken) {
		const authHeader = req.headers.get("authorization");
		if (authHeader) {
			const match = authHeader.match(/^Bearer\s+(.+)$/i);
			if (match && timingSafeEqual(match[1], config.authToken)) {
				return jsonResponse(200, {
					user: { username: "token" },
					auth_method: "bearer_token",
					discord_links: [],
				});
			}
		}
	}

	// Check session cookie
	const sessionId = getSessionCookie(req);
	if (sessionId) {
		const session = repository.getAuthSession(sessionId);
		if (session && session.expiresAt > nowMs()) {
			const discordLinks = repository.getDiscordUserLinksByAuthUserId(session.userId);
			return jsonResponse(200, {
				user: { username: session.username },
				auth_method: "session",
				session: { expires_at: session.expiresAt },
				discord_links: discordLinks.map((l) => ({
					discord_user_id: l.discordUserId,
					created_at: l.createdAt,
				})),
			});
		}
	}

	return unauthorizedResponse();
}

/**
 * Handle PUT /v1/auth/password
 */
export async function handleChangePassword(
	req: Request,
	deps: AuthDeps,
): Promise<Response> {
	const user = getAuthenticatedUser(req, deps);
	if (!user) {
		return unauthorizedResponse();
	}

	let body: { current_password?: string; new_password?: string };
	try {
		body = await req.json();
	} catch {
		return jsonResponse(400, {
			error: { code: "invalid_json", message: "Invalid JSON body" },
		});
	}

	const currentPassword = body.current_password;
	const newPassword = body.new_password;

	if (!currentPassword || !newPassword) {
		return jsonResponse(400, {
			error: {
				code: "invalid_params",
				message: "current_password and new_password are required",
			},
		});
	}

	const valid = await verifyPassword(currentPassword, user.passwordHash);
	if (!valid) {
		return jsonResponse(401, {
			error: {
				code: "invalid_credentials",
				message: "Current password is incorrect",
			},
		});
	}

	const pwCheck = validatePassword(newPassword);
	if (!pwCheck.valid) {
		return jsonResponse(400, {
			error: {
				code: "invalid_params",
				message: pwCheck.message!,
			},
		});
	}

	const hash = await hashPassword(newPassword);
	deps.repository.updateAuthUserPassword(user.id, hash);

	log.auth(`password_changed username=${user.username}`);
	return jsonResponse(200, { ok: true });
}

/**
 * Handle DELETE /v1/auth/discord/link (unlink)
 */
export function handleDiscordUnlink(
	req: Request,
	deps: AuthDeps,
): Response {
	const user = getAuthenticatedUser(req, deps);
	if (!user) {
		return unauthorizedResponse();
	}

	deps.repository.deleteDiscordUserLinkByAuthUserId(user.id);
	log.auth(`discord_unlink username=${user.username}`);
	return jsonResponse(200, { ok: true });
}

/**
 * Validate password meets minimum requirements.
 */
export function validatePassword(password: string): { valid: boolean; message?: string } {
	if (password.length < 1) {
		return { valid: false, message: "Password is required" };
	}
	return { valid: true };
}

export function unauthorizedResponse(): Response {
	return jsonResponse(401, {
		error: {
			code: "unauthorized",
			message: "Valid authentication required",
		},
	});
}

/**
 * Get session cookie value from request (exposed for WebSocket token extraction).
 */
export function extractSessionCookie(req: Request): string | null {
	return getSessionCookie(req);
}

/**
 * Get the authenticated user from a request (session cookie or bearer token).
 * Returns the AuthUser or null if not authenticated.
 */
export function getAuthenticatedUser(
	req: Request,
	deps: AuthDeps,
): AuthUser | null {
	const { config, repository } = deps;

	// Check session cookie
	const sessionId = getSessionCookie(req);
	if (sessionId) {
		const session = repository.getAuthSession(sessionId);
		if (session && session.expiresAt > nowMs()) {
			const user = repository.getAuthUser(session.userId);
			if (user) return user;
		}
	}

	// Check query param token as session ID
	const url = new URL(req.url);
	const tokenParam = url.searchParams.get("token");
	if (tokenParam) {
		const session = repository.getAuthSession(tokenParam);
		if (session && session.expiresAt > nowMs()) {
			const user = repository.getAuthUser(session.userId);
			if (user) return user;
		}
	}

	return null;
}

const DISCORD_LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const WEB_INITIATED_DISCORD_USER_ID = "*";

/**
 * Handle POST /v1/auth/discord/link/initiate — start Discord linking from the web UI.
 * Creates a temporary link code and returns the Discord OAuth URL.
 */
export function handleDiscordLinkInitiate(
	req: Request,
	deps: AuthDeps,
): Response {
	const user = getAuthenticatedUser(req, deps);
	if (!user) {
		return unauthorizedResponse();
	}

	const { config, repository } = deps;

	if (!config.discordClientId || !config.discordClientSecret) {
		return jsonResponse(400, {
			error: {
				code: "discord_not_configured",
				message: "Discord OAuth is not configured on this server",
			},
		});
	}

	const code = crypto.randomUUID();
	repository.createDiscordLinkCode({
		code,
		discordUserId: WEB_INITIATED_DISCORD_USER_ID,
		discordUsername: "web-initiated",
		expiresAt: nowMs() + DISCORD_LINK_CODE_TTL_MS,
	});

	const baseUrl = config.baseUrl ?? `http://${config.host}:${config.port}`;
	const redirectUri = `${baseUrl}/v1/auth/discord/callback`;
	const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(config.discordClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify&state=${encodeURIComponent(code)}`;

	log.auth(`discord_link_initiate username=${user.username}`);
	return jsonResponse(200, { oauth_url: oauthUrl });
}

/**
 * Handle GET /v1/auth/discord/link — show confirmation page or redirect to login.
 */
export function handleDiscordLinkPage(
	req: Request,
	deps: AuthDeps,
): Response {
	const url = new URL(req.url);
	const code = url.searchParams.get("code");

	if (!code) {
		return jsonResponse(400, {
			error: { code: "invalid_params", message: "code is required" },
		});
	}

	const linkCode = deps.repository.getDiscordLinkCode(code);
	if (!linkCode) {
		return new Response(htmlPage("Link Failed", "<p>Invalid or expired link code.</p>"), {
			status: 404,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	if (linkCode.expiresAt < nowMs()) {
		deps.repository.deleteDiscordLinkCode(code);
		return new Response(htmlPage("Link Expired", "<p>This link code has expired. Please run the command again in Discord.</p>"), {
			status: 410,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	const user = getAuthenticatedUser(req, deps);
	const escaped = escapeHtml(linkCode.discordUsername);

	// Not logged in: redirect to web UI login page, preserving the link code
	if (!user) {
		const loginUrl = `/?discord_link=${encodeURIComponent(code)}`;
		return new Response(null, {
			status: 302,
			headers: { location: loginUrl },
		});
	}

	// Logged in: show confirm button + optional "Verify with Discord" OAuth button
	let discordOAuthButton = "";
	if (deps.config.discordClientId && deps.config.discordClientSecret) {
		const baseUrl = deps.config.baseUrl ?? `http://${deps.config.host}:${deps.config.port}`;
		const redirectUri = `${baseUrl}/v1/auth/discord/callback`;
		const state = code; // pass the link code as OAuth2 state
		const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(deps.config.discordClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify&state=${encodeURIComponent(state)}`;
		discordOAuthButton = `<p style="color:#666;margin-top:16px">— or —</p>
		<p><a href="${escapeHtml(oauthUrl)}" style="display:inline-block;padding:10px 24px;font-size:16px;background:#5865F2;color:#fff;text-decoration:none;border-radius:4px;cursor:pointer;">Verify with Discord</a></p>`;
	}

	return new Response(htmlPage("Link Discord Account",
		`<p>Link Discord account <strong>@${escaped}</strong> to your account <strong>${escapeHtml(user.username)}</strong>?</p>
		<form method="POST" action="/v1/auth/discord/link">
			<input type="hidden" name="code" value="${escapeHtml(code)}" />
			<button type="submit" style="padding:8px 24px;font-size:16px;cursor:pointer;">Confirm Link</button>
		</form>${discordOAuthButton}`), {
		status: 200,
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

/**
 * Handle POST /v1/auth/discord/link — confirm the link.
 */
export async function handleDiscordLink(
	req: Request,
	deps: AuthDeps,
): Promise<Response> {
	const user = getAuthenticatedUser(req, deps);
	if (!user) {
		return unauthorizedResponse();
	}

	let code: string | undefined;
	const contentType = req.headers.get("content-type") ?? "";

	if (contentType.includes("application/json")) {
		try {
			const body = await req.json() as { code?: string };
			code = body.code;
		} catch {
			return jsonResponse(400, {
				error: { code: "invalid_json", message: "Invalid JSON body" },
			});
		}
	} else if (contentType.includes("application/x-www-form-urlencoded")) {
		const text = await req.text();
		const params = new URLSearchParams(text);
		code = params.get("code") ?? undefined;
	} else {
		try {
			const body = await req.json() as { code?: string };
			code = body.code;
		} catch {
			return jsonResponse(400, {
				error: { code: "invalid_json", message: "Invalid request body" },
			});
		}
	}

	if (!code) {
		return jsonResponse(400, {
			error: { code: "invalid_params", message: "code is required" },
		});
	}

	const linkCode = deps.repository.getDiscordLinkCode(code);
	if (!linkCode) {
		return jsonResponse(404, {
			error: { code: "code_not_found", message: "Link code not found" },
		});
	}

	if (linkCode.expiresAt < nowMs()) {
		deps.repository.deleteDiscordLinkCode(code);
		return jsonResponse(400, {
			error: { code: "code_expired", message: "Link code has expired" },
		});
	}

	deps.repository.createDiscordUserLink({
		discordUserId: linkCode.discordUserId,
		authUserId: user.id,
	});
	deps.repository.deleteDiscordLinkCode(code);

	log.auth(`discord_link discord_user=${linkCode.discordUsername} auth_user=${user.username}`);

	// If the request came from a form, return HTML
	if (contentType.includes("application/x-www-form-urlencoded")) {
		return new Response(htmlPage("Account Linked",
			`<p>Discord account <strong>@${escapeHtml(linkCode.discordUsername)}</strong> has been linked to your account.</p>
			<p>You can close this page and return to Discord.</p>`), {
			status: 200,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	return jsonResponse(200, {
		ok: true,
		discord_username: linkCode.discordUsername,
	});
}

/**
 * Handle GET /v1/auth/discord/callback — Discord OAuth2 callback.
 * Exchanges the authorization code for a token, gets user info,
 * auto-creates an auth user if needed, links the Discord account, and logs them in.
 */
export async function handleDiscordCallback(
	req: Request,
	deps: AuthDeps,
): Promise<Response> {
	const { config, repository } = deps;

	if (!config.discordClientId || !config.discordClientSecret) {
		return new Response(htmlPage("Error", "<p>Discord OAuth is not configured.</p>"), {
			status: 400,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	const url = new URL(req.url);
	const authCode = url.searchParams.get("code");
	const state = url.searchParams.get("state"); // this is our link code
	const error = url.searchParams.get("error");

	if (error) {
		return new Response(htmlPage("Authorization Failed",
			`<p>Discord authorization was denied or failed.</p><p><code>${escapeHtml(error)}</code></p>`), {
			status: 400,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	if (!authCode || !state) {
		return new Response(htmlPage("Error", "<p>Missing authorization code or state.</p>"), {
			status: 400,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	// Validate the link code (state)
	const linkCode = repository.getDiscordLinkCode(state);
	if (!linkCode) {
		return new Response(htmlPage("Link Failed", "<p>Invalid or expired link code.</p>"), {
			status: 404,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}
	if (linkCode.expiresAt < nowMs()) {
		repository.deleteDiscordLinkCode(state);
		return new Response(htmlPage("Link Expired", "<p>This link code has expired. Please run the command again in Discord.</p>"), {
			status: 410,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	// Exchange authorization code for access token
	const baseUrl = config.baseUrl ?? `http://${config.host}:${config.port}`;
	const redirectUri = `${baseUrl}/v1/auth/discord/callback`;

	let tokenData: { access_token?: string; token_type?: string };
	try {
		const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: config.discordClientId,
				client_secret: config.discordClientSecret,
				grant_type: "authorization_code",
				code: authCode,
				redirect_uri: redirectUri,
			}),
		});
		if (!tokenRes.ok) {
			log.auth(`discord_oauth token_exchange_failed status=${tokenRes.status}`);
			return new Response(htmlPage("Error", "<p>Failed to exchange authorization code with Discord.</p>"), {
				status: 502,
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		tokenData = await tokenRes.json();
	} catch {
		return new Response(htmlPage("Error", "<p>Failed to contact Discord.</p>"), {
			status: 502,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	if (!tokenData.access_token) {
		return new Response(htmlPage("Error", "<p>Discord did not return an access token.</p>"), {
			status: 502,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	// Get Discord user info
	let discordUser: { id?: string; username?: string; global_name?: string };
	try {
		const userRes = await fetch("https://discord.com/api/users/@me", {
			headers: { authorization: `Bearer ${tokenData.access_token}` },
		});
		if (!userRes.ok) {
			return new Response(htmlPage("Error", "<p>Failed to get Discord user info.</p>"), {
				status: 502,
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		discordUser = await userRes.json();
	} catch {
		return new Response(htmlPage("Error", "<p>Failed to contact Discord.</p>"), {
			status: 502,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	if (!discordUser.id || !discordUser.username) {
		return new Response(htmlPage("Error", "<p>Discord returned incomplete user info.</p>"), {
			status: 502,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	// Verify the OAuth2 user matches the Discord user who initiated the link
	// (skip check for web-initiated links where any Discord user is accepted)
	if (linkCode.discordUserId !== WEB_INITIATED_DISCORD_USER_ID && discordUser.id !== linkCode.discordUserId) {
		return new Response(htmlPage("User Mismatch",
			`<p>You signed in as a different Discord account than the one that requested the link.</p>
			<p>Expected: <strong>@${escapeHtml(linkCode.discordUsername)}</strong></p>
			<p>Got: <strong>@${escapeHtml(discordUser.username)}</strong></p>
			<p>Please try again with the correct Discord account.</p>`), {
			status: 403,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	// Require the user to be logged in — Discord OAuth is for identity verification, not registration
	const user = getAuthenticatedUser(req, deps);
	if (!user) {
		const linkPageUrl = `/v1/auth/discord/link?code=${encodeURIComponent(state)}`;
		return new Response(htmlPage("Login Required",
			`<p>You need to log in before linking your Discord account.</p>
			<p><a href="${escapeHtml(linkPageUrl)}">Go back to the link page</a></p>`), {
			status: 401,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	log.auth(`discord_oauth_verify discord_user=${discordUser.username} auth_user=${user.username}`);

	// Create the Discord user link
	repository.createDiscordUserLink({
		discordUserId: discordUser.id,
		authUserId: user.id,
	});
	repository.deleteDiscordLinkCode(state);

	log.auth(`discord_oauth_link discord_user=${discordUser.username} auth_user=${user.username}`);

	const isWebInitiated = linkCode.discordUserId === WEB_INITIATED_DISCORD_USER_ID;
	const returnMessage = isWebInitiated
		? `<p><a href="/">Return to the app</a></p>`
		: `<p>You can close this page and return to Discord.</p>`;

	return new Response(htmlPage("Account Linked",
		`<p>Discord account <strong>@${escapeHtml(discordUser.username)}</strong> has been linked successfully.</p>
		${returnMessage}`), {
		status: 200,
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function htmlPage(title: string, body: string): string {
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#222}button{background:#5865F2;color:#fff;border:none;border-radius:4px}</style>
</head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

export { DISCORD_LINK_CODE_TTL_MS };
