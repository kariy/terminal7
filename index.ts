import { query } from "@anthropic-ai/claude-agent-sdk";
import * as readline from "readline";

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function ask(prompt: string): Promise<string> {
	return new Promise((resolve) => rl.question(prompt, resolve));
}

let sessionId: string | undefined;

async function chat(prompt: string) {
	for await (const message of query({
		prompt,
		options: {
			allowedTools: ["Read", "Glob", "Grep", "Bash"],
			includePartialMessages: true,
			...(sessionId && { resume: sessionId }),
		},
	})) {
		if (message.type === "system" && message.subtype === "init") {
			sessionId = message.session_id;
		}

		if (message.type === "stream_event") {
			const { event } = message;
			if (
				event.type === "content_block_delta" &&
				event.delta.type === "text_delta"
			) {
				process.stdout.write(event.delta.text);
			}
		}

		if (message.type === "result") {
			console.log("\n");
		}
	}
}

const firstPrompt = process.argv[2] ?? "What files are in this directory?";
console.log(`You: ${firstPrompt}\n`);
await chat(firstPrompt);

while (true) {
	const input = await ask("You: ");
	if (!input || input === "exit" || input === "quit") {
		console.log("Goodbye!");
		rl.close();
		break;
	}
	console.log();
	await chat(input);
}
