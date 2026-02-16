import { homedir } from "os";
import { join } from "path";

export interface ManagerConfig {
	host: string;
	port: number;
	dbPath: string;
	claudeProjectsDir: string;
	bootstrapNonce?: string;
	allowedTools: string[];
	maxHistoryMessages: number;
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

	return {
		host: process.env.CC_MANAGER_HOST ?? "127.0.0.1",
		port: parseIntegerEnv("CC_MANAGER_PORT", 8787),
		dbPath,
		claudeProjectsDir,
		bootstrapNonce: process.env.CC_MANAGER_BOOTSTRAP_NONCE,
		allowedTools: parseAllowedTools(),
		maxHistoryMessages: parseIntegerEnv("CC_MANAGER_MAX_HISTORY_MESSAGES", 5000),
	};
}
