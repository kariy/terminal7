import { query } from "@anthropic-ai/claude-agent-sdk";

export interface StreamPromptArgs {
	requestId: string;
	prompt: string;
	cwd: string;
	resumeSessionId?: string;
	allowedTools: string[];
	onSessionId: (sessionId: string) => void;
	onDelta: (text: string) => void;
	onDone: () => void;
	onError: (error: unknown) => void;
}

export class ClaudeService {
	private readonly running = new Map<string, ReturnType<typeof query>>();

	async streamPrompt(args: StreamPromptArgs): Promise<void> {
		const q = query({
			prompt: args.prompt,
			options: {
				allowedTools: args.allowedTools,
				includePartialMessages: true,
				cwd: args.cwd,
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

				if (message.type === "stream_event") {
					const { event } = message;
					if (
						event.type === "content_block_delta" &&
						event.delta.type === "text_delta"
					) {
						args.onDelta(event.delta.text);
					}
				}

				if (message.type === "result") {
					if (!didEmitDone) {
						didEmitDone = true;
						args.onDone();
					}
				}
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
