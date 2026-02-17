import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export interface StreamPromptArgs {
	requestId: string;
	prompt: string;
	cwd?: string;
	resumeSessionId?: string;
	allowedTools: string[];
	onSessionId: (sessionId: string) => void;
	onMessage: (message: SDKMessage) => void;
	onDone: () => void;
	onError: (error: unknown) => void;
}

export interface ClaudeServiceLike {
	streamPrompt(args: StreamPromptArgs): Promise<void>;
	stopRequest(requestId: string): boolean;
}

export class ClaudeService implements ClaudeServiceLike {
	private readonly running = new Map<string, ReturnType<typeof query>>();

	async streamPrompt(args: StreamPromptArgs): Promise<void> {
		console.log("args", args);

		const q = query({
			prompt: args.prompt,
			options: {
				allowedTools: ["Read", "Glob", "Grep", "Bash"],
				includePartialMessages: true,
				...(args.cwd && { cwd: args.cwd }),
				...(args.resumeSessionId && { resume: args.resumeSessionId }),
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
