import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

async function step(label: string) {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`  ${label}`);
	console.log(`${"=".repeat(60)}\n`);
}

/** Read session history from the JSONL file on disk. */
function readSessionHistory(sessionId: string) {
	// Session files live at ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
	// The cwd is encoded by replacing / with -
	const cwd = process.cwd();
	const encodedCwd = cwd.replace(/\//g, "-");
	const sessionPath = join(
		homedir(),
		".claude",
		"projects",
		encodedCwd,
		`${sessionId}.jsonl`,
	);

	const lines = readFileSync(sessionPath, "utf-8")
		.split("\n")
		.filter(Boolean);

	const messages: Array<{
		role: "user" | "assistant";
		text: string;
		uuid: string;
	}> = [];

	for (const line of lines) {
		const entry = JSON.parse(line);
		if (entry.type === "user" && entry.message) {
			const content = entry.message.content;
			const text =
				typeof content === "string"
					? content
					: content
							.filter((b: any) => b.type === "text")
							.map((b: any) => b.text)
							.join("");
			messages.push({ role: "user", text, uuid: entry.uuid });
		} else if (entry.type === "assistant" && entry.message) {
			const text = entry.message.content
				.filter((b: any) => b.type === "text")
				.map((b: any) => b.text)
				.join("");
			messages.push({ role: "assistant", text, uuid: entry.uuid });
		}
	}

	return messages;
}

// ── Step 1: Create a session via the SDK ────────────────────
await step("Step 1: Create session via SDK");

let sessionId: string | undefined;
let resultText = "";

for await (const message of query({
	prompt: "Remember the secret word: BANANA. Just confirm you've noted it.",
	options: {
		allowedTools: [],
	},
})) {
	if (message.type === "system" && message.subtype === "init") {
		sessionId = message.session_id;
	}
	if (message.type === "result") {
		resultText =
			message.subtype === "success"
				? message.result
				: message.errors.join("\n");
	}
}

console.log(`Session ID: ${sessionId}`);
console.log(`Response: ${resultText.slice(0, 200)}`);

if (!sessionId) {
	console.error("FAILED: No session ID returned");
	process.exit(1);
}

// ── Step 2: Resume via `claude -r` binary ───────────────────
await step("Step 2: Resume session via CLI binary");

const cleanEnv = { ...process.env };
delete cleanEnv.CLAUDECODE;
delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

const cliProc = Bun.spawn(
	["claude", "-r", sessionId, "-p", "What was the secret word I told you?"],
	{
		stdout: "pipe",
		stderr: "pipe",
		env: cleanEnv,
	},
);

const cliStdout = await new Response(cliProc.stdout).text();
const cliStderr = await new Response(cliProc.stderr).text();
const cliExit = await cliProc.exited;

console.log(`Exit code: ${cliExit}`);
console.log(`Response: ${cliStdout.slice(0, 200)}`);
if (cliStderr) console.log(`Stderr: ${cliStderr.slice(0, 200)}`);

if (cliExit !== 0) {
	console.error("FAILED: CLI resume failed");
	process.exit(1);
}

// ── Step 3: Read history from JSONL before resuming ─────────
await step("Step 3: Read session history from disk");

const history = readSessionHistory(sessionId);
console.log(`Found ${history.length} messages:\n`);
for (const msg of history) {
	const preview = msg.text.slice(0, 100).replace(/\n/g, " ");
	console.log(`  [${msg.role}] ${preview}`);
}

// ── Step 4: Resume again via SDK ────────────────────────────
await step("Step 4: Resume session again via SDK");

let finalText = "";

for await (const message of query({
	prompt: "What was the secret word? Also, how many times have I asked you about it?",
	options: {
		allowedTools: [],
		resume: sessionId,
	},
})) {
	if (message.type === "result") {
		finalText =
			message.subtype === "success"
				? message.result
				: message.errors.join("\n");
	}
}

console.log(`Response: ${finalText.slice(0, 300)}`);

// ── Step 5: Read updated history ────────────────────────────
await step("Step 5: Updated session history from disk");

const updatedHistory = readSessionHistory(sessionId);
console.log(`Found ${updatedHistory.length} messages:\n`);
for (const msg of updatedHistory) {
	const preview = msg.text.slice(0, 100).replace(/\n/g, " ");
	console.log(`  [${msg.role}] ${preview}`);
}

await step("DONE — All steps completed successfully");
