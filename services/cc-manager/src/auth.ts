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
				});
			}
		}
	}

	// Check session cookie
	const sessionId = getSessionCookie(req);
	if (sessionId) {
		const session = repository.getAuthSession(sessionId);
		if (session && session.expiresAt > nowMs()) {
			return jsonResponse(200, {
				user: { username: session.username },
				auth_method: "session",
				session: { expires_at: session.expiresAt },
			});
		}
	}

	return unauthorizedResponse();
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
