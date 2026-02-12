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
			...(sessionId && { resume: true, sessionId }),
		},
	})) {
		if (message.type === "system" && message.subtype === "init") {
			sessionId = message.sessionId;
		}

		if (message.type === "assistant" && message.message?.content) {
			for (const block of message.message.content) {
				if (block.type === "text") {
					process.stdout.write(block.text);
				}
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
