import {
	Client,
	GatewayIntentBits,
	type Message,
	type ThreadChannel,
} from "discord.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ManagerConfig } from "./config";
import type { ManagerRepository } from "./repository";
import type {
	ClaudeServiceLike,
	ToolPermissionDecision,
	ToolPermissionRequest,
} from "./claude-service";
import { isExitPlanModeTool, isAskUserQuestionTool } from "./claude-service";
import { encodeCwd, truncate } from "./utils";
import { log } from "./logger";

const DISCORD_MAX_LENGTH = 2000;
const REACTION_TIMEOUT_MS = 5 * 60 * 1000;
const NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"] as const;

interface DiscordServiceDeps {
	config: NonNullable<ManagerConfig["discord"]>;
	globalConfig: ManagerConfig;
	repository: ManagerRepository;
	claudeService: ClaudeServiceLike;
}

export class DiscordService {
	private client: Client | null = null;
	private readonly config: DiscordServiceDeps["config"];
	private readonly globalConfig: ManagerConfig;
	private readonly repository: ManagerRepository;
	private readonly claudeService: ClaudeServiceLike;
	private readonly threadQueues = new Map<string, Promise<void>>();

	constructor(deps: DiscordServiceDeps) {
		this.config = deps.config;
		this.globalConfig = deps.globalConfig;
		this.repository = deps.repository;
		this.claudeService = deps.claudeService;
	}

	async start(): Promise<void> {
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.GuildMessageReactions,
			],
		});

		this.client.on("messageCreate", (message) => {
			this.handleMessage(message).catch((err) => {
				log.discord(`unhandled error: ${err}`);
			});
		});

		await this.client.login(this.config.token);
	}

	stop(): void {
		this.client?.destroy();
		this.client = null;
	}

	private async handleMessage(message: Message): Promise<void> {
		if (message.author.bot) return;
		if (!this.client?.user) return;

		const stripMention = (text: string) =>
			text.replace(new RegExp(`<@!?${this.client!.user!.id}>`, "g"), "").trim();

		// Fetch replied-to message content if this is a reply
		let replyContext = "";
		if (message.reference?.messageId) {
			try {
				const replied = await message.fetchReference();
				if (replied.content) {
					replyContext = `[Replied-to message from ${replied.author.displayName}]:\n${replied.content}\n\n`;
				}
			} catch {
				// Could not fetch referenced message
			}
		}

		// In threads we manage, respond to all messages (no mention needed)
		if (message.channel.isThread()) {
			const threadId = message.channel.id;
			const mapping = this.repository.getDiscordThreadSession(threadId);
			if (!mapping) return;

			const prompt = replyContext + stripMention(message.content);
			if (!prompt) return;

			this.enqueueForThread(threadId, () =>
				this.executePrompt(
					message.channel as ThreadChannel,
					prompt,
					mapping.cwd,
					mapping.sessionId,
				),
			);
			return;
		}

		// In channels, require a mention to start a new thread
		if (!message.mentions.has(this.client.user.id)) return;

		const prompt = replyContext + stripMention(message.content);
		if (!prompt) return;

		{
			let thread: ThreadChannel;
			try {
				thread = await message.startThread({
					name: truncate(prompt, 100),
				});
			} catch (err) {
				log.discord(`failed to create thread: ${err}`);
				return;
			}

			this.enqueueForThread(thread.id, () =>
				this.executePrompt(thread, prompt, this.config.defaultCwd),
			);
		}
	}

	private enqueueForThread(
		threadId: string,
		fn: () => Promise<void>,
	): void {
		const prev = this.threadQueues.get(threadId) ?? Promise.resolve();
		const next = prev.then(fn, fn);
		this.threadQueues.set(threadId, next);
		next.finally(() => {
			if (this.threadQueues.get(threadId) === next) {
				this.threadQueues.delete(threadId);
			}
		});
	}

	private async executePrompt(
		thread: ThreadChannel,
		prompt: string,
		cwd: string,
		resumeSessionId?: string,
	): Promise<void> {
		const requestId = crypto.randomUUID();
		const ecwd = encodeCwd(cwd);
		let accumulatedText = "";
		let totalCostUsd = 0;
		let resolvedSessionId = resumeSessionId;
		let placeholderMessage: Message | null = null;

		try {
			await this.claudeService.streamPrompt({
				requestId,
				prompt,
				cwd,
				resumeSessionId,
				allowedTools: this.globalConfig.allowedTools,
				onSessionId: (sessionId) => {
					resolvedSessionId = sessionId;

					this.repository.upsertSessionMetadata({
						sessionId,
						encodedCwd: ecwd,
						cwd,
						title: truncate(prompt.replace(/\s+/g, " "), 120),
						source: "db",
					});

					if (!resumeSessionId && thread.guildId) {
						this.repository.insertDiscordThreadSession({
							threadId: thread.id,
							channelId: thread.parentId ?? thread.id,
							guildId: thread.guildId,
							sessionId,
							encodedCwd: ecwd,
							cwd,
						});
					}

					thread.send("Thinking...").then((msg) => {
						placeholderMessage = msg;
					}).catch(() => {});
				},
				onMessage: (message: SDKMessage) => {
					if (
						message.type === "stream_event" &&
						message.event.type === "content_block_delta" &&
						(message.event.delta as { type: string }).type === "text_delta"
					) {
						accumulatedText += (message.event.delta as { type: string; text: string }).text;
					}

					if (
						message.type === "result" &&
						typeof (message as Record<string, unknown>).total_cost_usd ===
							"number"
					) {
						totalCostUsd = (message as Record<string, unknown>)
							.total_cost_usd as number;
					}
				},
				onDone: () => {},
				onError: (error) => {
					thread.send(`Error: ${String(error)}`).catch(() => {});
				},
				onPermissionRequest: (request) =>
					this.handlePermission(thread, request),
			});

			// Delete placeholder
			if (placeholderMessage) {
				try {
					await (placeholderMessage as Message).delete();
				} catch {
					// Already deleted or no permissions
				}
			}

			// Send accumulated text
			if (accumulatedText.trim()) {
				const chunks = splitMessage(accumulatedText);
				for (const chunk of chunks) {
					await thread.send(chunk);
				}
			} else {
				await thread.send("(No text response)");
			}

			// Update session metadata with cost
			if (resolvedSessionId) {
				this.repository.upsertSessionMetadata({
					sessionId: resolvedSessionId,
					encodedCwd: ecwd,
					cwd,
					title: truncate(prompt.replace(/\s+/g, " "), 120),
					source: "db",
					costToAdd: totalCostUsd,
				});
			}
		} catch (err) {
			log.discord(`executePrompt error: ${err}`);
			thread.send(`Error: ${String(err)}`).catch(() => {});
		}
	}

	private async handlePermission(
		thread: ThreadChannel,
		request: ToolPermissionRequest,
	): Promise<ToolPermissionDecision> {
		if (isExitPlanModeTool(request.toolName)) {
			return {
				behavior: "allow",
				mode: "acceptEdits",
				updatedInput: request.toolInput,
			};
		}

		if (isAskUserQuestionTool(request.toolName, request.toolInput)) {
			return this.handleAskUserQuestion(thread, request);
		}

		return { behavior: "allow" };
	}

	private async handleAskUserQuestion(
		thread: ThreadChannel,
		request: ToolPermissionRequest,
	): Promise<ToolPermissionDecision> {
		const questions = request.toolInput.questions as Array<{
			question: string;
			options: Array<{ label: string; description?: string }>;
			multiSelect?: boolean;
		}>;

		if (!Array.isArray(questions) || questions.length === 0) {
			return { behavior: "allow", updatedInput: request.toolInput };
		}

		const answers: Record<string, string> = {};

		for (const q of questions) {
			const optionLines = q.options
				.map(
					(opt, i) =>
						`${NUMBER_EMOJIS[i]} **${opt.label}**${opt.description ? ` — ${opt.description}` : ""}`,
				)
				.join("\n");

			const questionText = `**${q.question}**\n${optionLines}`;
			let questionMsg: Message;
			try {
				questionMsg = await thread.send(questionText);
			} catch {
				return { behavior: "deny", message: "Failed to post question." };
			}

			const emojisToAdd = q.options
				.slice(0, NUMBER_EMOJIS.length)
				.map((_, i) => NUMBER_EMOJIS[i]);

			// Start collector before adding reactions to avoid race condition
			const collectorPromise = questionMsg.awaitReactions({
				filter: (reaction, user) => {
					if (user.bot) return false;
					const emoji = reaction.emoji.name;
					return emoji != null && emojisToAdd.includes(emoji as typeof NUMBER_EMOJIS[number]);
				},
				max: 1,
				time: REACTION_TIMEOUT_MS,
			});

			for (const emoji of emojisToAdd) {
				await questionMsg.react(emoji).catch(() => {});
			}

			try {
				const collected = await collectorPromise;

				const firstReaction = collected.first();
				if (!firstReaction) {
					return {
						behavior: "deny",
						message: "Timed out waiting for response.",
					};
				}

				const emojiName = firstReaction.emoji.name;
				const selectedIndex = NUMBER_EMOJIS.indexOf(
					emojiName as typeof NUMBER_EMOJIS[number],
				);
				const selectedOption = q.options[selectedIndex];
				if (selectedOption) {
					answers[q.question] = selectedOption.label;
				}
			} catch {
				return {
					behavior: "deny",
					message: "Timed out waiting for response.",
				};
			}
		}

		return {
			behavior: "allow",
			updatedInput: {
				...request.toolInput,
				answers,
			},
		};
	}
}

function splitMessage(text: string): string[] {
	if (text.length <= DISCORD_MAX_LENGTH) return [text];

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > DISCORD_MAX_LENGTH) {
		const slice = remaining.slice(0, DISCORD_MAX_LENGTH);
		let splitAt = slice.lastIndexOf("\n");
		if (splitAt === -1 || splitAt < DISCORD_MAX_LENGTH / 2) {
			splitAt = slice.lastIndexOf(" ");
		}
		if (splitAt === -1 || splitAt < DISCORD_MAX_LENGTH / 2) {
			splitAt = DISCORD_MAX_LENGTH;
		}
		chunks.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).replace(/^\n/, "");
	}

	if (remaining.length > 0) {
		chunks.push(remaining);
	}

	return chunks;
}
