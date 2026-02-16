import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { ManagerRepository } from "./repository";
import type { HistoryMessage, SessionHistoryResult } from "./types";
import { decodeEncodedCwd, extractTextBlocks, truncate } from "./utils";

interface RefreshStats {
	indexed: number;
	skippedUnchanged: number;
	parseErrors: number;
}

export class ClaudeJsonlIndexer {
	constructor(
		private readonly projectsDir: string,
		private readonly repository: ManagerRepository,
		private readonly maxHistoryMessages: number,
	) {}

	refreshIndex(): RefreshStats {
		if (!existsSync(this.projectsDir)) {
			return { indexed: 0, skippedUnchanged: 0, parseErrors: 0 };
		}

		let indexed = 0;
		let skippedUnchanged = 0;
		let parseErrors = 0;

		const projectEntries = readdirSync(this.projectsDir, {
			withFileTypes: true,
		});

		for (const projectEntry of projectEntries) {
			if (!projectEntry.isDirectory()) continue;
			const encodedCwd = projectEntry.name;
			const projectPath = join(this.projectsDir, encodedCwd);

			let sessionFiles: string[] = [];
			try {
				sessionFiles = readdirSync(projectPath).filter((name) =>
					name.endsWith(".jsonl"),
				);
			} catch {
				parseErrors += 1;
				continue;
			}

			for (const sessionFile of sessionFiles) {
				const sessionId = sessionFile.slice(0, -".jsonl".length);
				const jsonlPath = join(projectPath, sessionFile);

				let fileStat: ReturnType<typeof statSync>;
				try {
					fileStat = statSync(jsonlPath);
				} catch {
					parseErrors += 1;
					continue;
				}

				const existing = this.repository.getFileIndex(sessionId, encodedCwd);
				if (
					existing &&
					existing.file_mtime_ms === Math.floor(fileStat.mtimeMs) &&
					existing.file_size === fileStat.size
				) {
					skippedUnchanged += 1;
					continue;
				}

				try {
					const parsed = this.parseSessionJsonl(jsonlPath);
					const decodedCwd = decodeEncodedCwd(encodedCwd);
					const cwd = existsSync(decodedCwd) ? decodedCwd : encodedCwd;
					this.repository.upsertSessionMetadata({
						sessionId,
						encodedCwd,
						cwd,
						title:
							parsed.firstUserText.length > 0
								? truncate(parsed.firstUserText.replace(/\s+/g, " "), 120)
								: `Session ${sessionId.slice(0, 8)}`,
						lastActivityAt: Math.floor(fileStat.mtimeMs),
						source: "jsonl",
					});
					this.repository.upsertJsonlIndex({
						sessionId,
						encodedCwd,
						cwd,
						title: parsed.firstUserText,
						lastActivityAt: Math.floor(fileStat.mtimeMs),
						messageCount: parsed.messageCount,
						jsonlPath,
						fileSize: fileStat.size,
						fileMtimeMs: Math.floor(fileStat.mtimeMs),
					});
					indexed += 1;
				} catch {
					parseErrors += 1;
				}
			}
		}

		return { indexed, skippedUnchanged, parseErrors };
	}

	readHistory(params: {
		sessionId: string;
		encodedCwd: string;
		cursor?: number;
	}): SessionHistoryResult {
		const filePath = this.resolveJsonlPath(params.sessionId, params.encodedCwd);
		if (!filePath || !existsSync(filePath)) {
			return { messages: [], nextCursor: null, totalMessages: 0 };
		}

		const rows = this.parseSessionJsonl(filePath).messages;
		const start = Math.max(0, params.cursor ?? 0);
		const clipped = rows.slice(start, start + this.maxHistoryMessages);
		const nextCursor =
			start + clipped.length < rows.length ? start + clipped.length : null;

		return {
			messages: clipped,
			nextCursor,
			totalMessages: rows.length,
		};
	}

	private resolveJsonlPath(sessionId: string, encodedCwd: string): string | null {
		const row = this.repository.getFileIndex(sessionId, encodedCwd);
		if (row?.jsonl_path) return row.jsonl_path;
		return join(this.projectsDir, encodedCwd, `${sessionId}.jsonl`);
	}

	private parseSessionJsonl(filePath: string): {
		messages: HistoryMessage[];
		messageCount: number;
		firstUserText: string;
	} {
		const raw = readFileSync(filePath, "utf8");
		const lines = raw.split("\n").filter(Boolean);
		const messages: HistoryMessage[] = [];
		let firstUserText = "";

		for (const line of lines) {
			let parsed: any;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}

			if (parsed.type === "user" && parsed.message) {
				const text = extractTextBlocks(parsed.message.content).trim();
				if (text.length === 0) continue;
				messages.push({ role: "user", text, uuid: parsed.uuid });
				if (!firstUserText) firstUserText = text;
				continue;
			}

			if (parsed.type === "assistant" && parsed.message) {
				const text = extractTextBlocks(parsed.message.content).trim();
				if (text.length === 0) continue;
				messages.push({ role: "assistant", text, uuid: parsed.uuid });
			}
		}

		return {
			messages,
			messageCount: messages.length,
			firstUserText,
		};
	}
}
