import {
	query,
	type PermissionUpdate,
	type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

type ExitPlanModePermissionMode = "default" | "acceptEdits" | "bypassPermissions";
type SessionPermissionMode = "default" | "plan" | "bypassPermissions";

export interface StreamPromptArgs {
	requestId: string;
	prompt: string;
	cwd?: string;
	resumeSessionId?: string;
	permissionMode?: SessionPermissionMode;
	allowedTools: string[];
	onSessionId: (sessionId: string) => void;
	onMessage: (message: SDKMessage) => void;
	onDone: () => void;
	onError: (error: unknown) => void;
	onPermissionRequest?: (
		request: ToolPermissionRequest,
	) => Promise<ToolPermissionDecision>;
}

export interface ToolPermissionRequest {
	permissionRequestId: string;
	promptRequestId: string;
	toolName: string;
	toolUseId: string;
	toolInput: Record<string, unknown>;
	suggestions?: PermissionUpdate[];
	signal: AbortSignal;
}

export interface ToolPermissionDecision {
	behavior: "allow" | "deny";
	message?: string;
	mode?: ExitPlanModePermissionMode;
	updatedPermissions?: PermissionUpdate[];
	updatedInput?: Record<string, unknown>;
}

export interface ClaudeServiceLike {
	streamPrompt(args: StreamPromptArgs): Promise<void>;
	stopRequest(requestId: string): boolean;
}

export class ClaudeService implements ClaudeServiceLike {
	private readonly running = new Map<string, ReturnType<typeof query>>();

	async streamPrompt(args: StreamPromptArgs): Promise<void> {
		const q = query({
			prompt: args.prompt,
			options: {
				allowedTools: args.allowedTools,
				includePartialMessages: true,
				...(args.cwd && { cwd: args.cwd }),
				...(args.resumeSessionId && { resume: args.resumeSessionId }),
				...(args.permissionMode && { permissionMode: args.permissionMode }),
				...(args.permissionMode === "bypassPermissions" && {
					allowDangerouslySkipPermissions: true,
				}),
				...(args.onPermissionRequest && {
					canUseTool: async (
						toolName,
						input,
						options,
					) => {
						const toolInput = ensureRecord(input);
						const isExitPlanMode = isExitPlanModeTool(toolName);
						const isAskUserQuestion =
							isAskUserQuestionTool(toolName, toolInput);

						// Keep the existing behavior for tools that don't require explicit
						// user interaction in this UI:
						// allow and apply SDK-provided suggestions when available.
						if (!isExitPlanMode && !isAskUserQuestion) {
							return {
								behavior: "allow",
								updatedPermissions: options.suggestions,
								toolUseID: options.toolUseID,
							};
						}

						try {
							const decision = await args.onPermissionRequest!({
								permissionRequestId: crypto.randomUUID(),
								promptRequestId: args.requestId,
								toolName,
								toolUseId: options.toolUseID,
								toolInput,
								suggestions: options.suggestions,
								signal: options.signal,
							});

							if (decision.behavior === "allow") {
								const response: {
									behavior: "allow";
									toolUseID: string;
									updatedPermissions?: PermissionUpdate[];
									updatedInput?: Record<string, unknown>;
								} = {
									behavior: "allow",
									toolUseID: options.toolUseID,
								};

								if (isExitPlanMode) {
									response.updatedPermissions =
										decision.updatedPermissions ??
										buildExitPlanModePermissionUpdates(
											toolInput,
											decision.mode ?? "default",
										);
								} else {
									response.updatedPermissions =
										decision.updatedPermissions ??
										options.suggestions;
								}

								if (decision.updatedInput) {
									response.updatedInput = decision.updatedInput;
								} else if (isExitPlanMode || isAskUserQuestion) {
									// Interactive approval tools must carry updatedInput.
									response.updatedInput = toolInput;
								}

								return response;
							}

							return {
								behavior: "deny",
								message:
									decision.message ??
									(isAskUserQuestion
										? "User input was not provided."
										: "Exit plan mode was rejected."),
								toolUseID: options.toolUseID,
							};
						} catch (error) {
							return {
								behavior: "deny",
								message:
									error instanceof Error
										? error.message
										: "Failed to process permission request.",
								toolUseID: options.toolUseID,
							};
						}
					},
				}),
			},
		});

		this.running.set(args.requestId, q);
		let didEmitDone = false;

		try {
			for await (const message of q) {
				if (message.type === "system" && message.subtype === "init") {
					args.onSessionId(message.session_id);
				}

				args.onMessage(message);
			}

			if (!didEmitDone) {
				didEmitDone = true;
				args.onDone();
			}
		} catch (error) {
			args.onError(error);
		} finally {
			this.running.delete(args.requestId);
		}
	}

	stopRequest(requestId: string): boolean {
		const running = this.running.get(requestId);
		if (!running) return false;
		running.close();
		this.running.delete(requestId);
		return true;
	}
}

function buildExitPlanModePermissionUpdates(
	input: Record<string, unknown>,
	mode: ExitPlanModePermissionMode,
): PermissionUpdate[] {
	const updates: PermissionUpdate[] = [
		{
			type: "setMode",
			mode,
			destination: "session",
		},
	];

	const rules = parseExitPlanAllowedPrompts(input).map((entry) => ({
		toolName: entry.tool,
		ruleContent: entry.prompt,
	}));

	if (rules.length > 0) {
		updates.push({
			type: "addRules",
			rules,
			behavior: "allow",
			destination: "session",
		});
	}

	return updates;
}

function parseExitPlanAllowedPrompts(
	input: Record<string, unknown>,
): Array<{ tool: string; prompt: string }> {
	const raw = input.allowedPrompts;
	if (!Array.isArray(raw)) return [];

	const result: Array<{ tool: string; prompt: string }> = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		const tool = item.tool;
		const prompt = item.prompt;
		if (typeof tool !== "string" || typeof prompt !== "string") continue;
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) continue;
		result.push({ tool, prompt: trimmedPrompt });
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeToolName(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function ensureRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function isExitPlanModeTool(toolName: string): boolean {
	const normalized = normalizeToolName(toolName);
	return normalized === "exitplanmode" || normalized.endsWith("exitplanmode");
}

function isAskUserQuestionTool(
	toolName: string,
	input: unknown,
): boolean {
	const recordInput = ensureRecord(input);
	const normalized = normalizeToolName(toolName);
	if (
		normalized === "askuserquestion" ||
		normalized.endsWith("askuserquestion") ||
		normalized.includes("askuserquestion")
	) {
		return true;
	}

	return looksLikeAskUserQuestionInput(recordInput);
}

function looksLikeAskUserQuestionInput(input: Record<string, unknown>): boolean {
	const rawQuestions = input.questions;
	if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return false;

	for (const question of rawQuestions) {
		if (!isRecord(question)) return false;
		if (typeof question.question !== "string") return false;
		if (!Array.isArray(question.options) || question.options.length === 0) {
			return false;
		}
		for (const option of question.options) {
			if (!isRecord(option)) return false;
			if (typeof option.label !== "string") return false;
		}
	}

	return true;
}
