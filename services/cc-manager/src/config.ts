import { homedir } from "os";
import { join } from "path";

export interface ManagerConfig {
	host: string;
	port: number;
	dbPath: string;
	claudeProjectsDir: string;
	allowedTools: string[];
	maxHistoryMessages: number;
	defaultCwd: string;
	projectsDir: string;
	authToken?: string;
	googleClientId?: string;
	cookieSecure: "auto" | "always" | "never";
	rateLimitWindowMs: number;
	rateLimitMaxAttempts: number;
	trustProxy: boolean;
	discord?: {
		token: string;
		defaultCwd: string;
	};
}

function parseIntegerEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (Number.isNaN(parsed) || parsed <= 0) return fallback;
	return parsed;
}

function resolvePath(raw: string): string {
	if (raw.startsWith("~/")) {
		return join(homedir(), raw.slice(2));
	}
	return raw;
}

function parseAllowedTools(): string[] {
	const raw = process.env.CC_MANAGER_ALLOWED_TOOLS;
	if (!raw || raw.trim().length === 0) {
		return ["Read", "Glob", "Grep", "Bash"];
	}

	return raw
		.split(",")
		.map((tool) => tool.trim())
		.filter(Boolean);
}

export function loadConfig(): ManagerConfig {
	const dbPath = resolvePath(
		process.env.CC_MANAGER_DB_PATH ?? "~/.cc-manager/manager.db",
	);
	const claudeProjectsDir = resolvePath(
		process.env.CC_MANAGER_CLAUDE_PROJECTS_DIR ?? "~/.claude/projects",
	);

	const projectsDir = resolvePath(
		process.env.CC_MANAGER_PROJECTS_DIR ?? "~/.cc-manager/projects",
	);

	const defaultCwd = resolvePath(process.env.CC_MANAGER_DEFAULT_CWD ?? "/");

	const discordToken = process.env.CC_MANAGER_DISCORD_TOKEN;
	const discord = discordToken
		? {
				token: discordToken,
				defaultCwd: resolvePath(
					process.env.CC_MANAGER_DISCORD_DEFAULT_CWD ?? defaultCwd,
				),
			}
		: undefined;

	const authToken = process.env.CC_MANAGER_AUTH_TOKEN || undefined;
	const googleClientId = process.env.CC_MANAGER_GOOGLE_CLIENT_ID || undefined;

	const cookieSecureRaw = process.env.CC_MANAGER_COOKIE_SECURE ?? "auto";
	const cookieSecure = (["auto", "always", "never"].includes(cookieSecureRaw) ? cookieSecureRaw : "auto") as "auto" | "always" | "never";

	const rateLimitWindowMs = parseIntegerEnv("CC_MANAGER_RATE_LIMIT_WINDOW_SECS", 900) * 1000;
	const rateLimitMaxAttempts = parseIntegerEnv("CC_MANAGER_RATE_LIMIT_MAX_ATTEMPTS", 10);
	const trustProxy = process.env.CC_MANAGER_TRUST_PROXY === "true";

	return {
		host: process.env.CC_MANAGER_HOST ?? "127.0.0.1",
		port: parseIntegerEnv("CC_MANAGER_PORT", 8787),
		dbPath,
		claudeProjectsDir,
		allowedTools: parseAllowedTools(),
		maxHistoryMessages: parseIntegerEnv("CC_MANAGER_MAX_HISTORY_MESSAGES", 5000),
		defaultCwd,
		projectsDir,
		authToken,
		googleClientId,
		cookieSecure,
		rateLimitWindowMs,
		rateLimitMaxAttempts,
		trustProxy,
		discord,
	};
}
