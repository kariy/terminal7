import { query } from "@anthropic-ai/claude-agent-sdk";

async function step(label: string) {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`  ${label}`);
	console.log(`${"=".repeat(60)}\n`);
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
		resultText = message.result as string;
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

// ── Step 3: Resume again via SDK ────────────────────────────
await step("Step 3: Resume session again via SDK");

let finalText = "";

for await (const message of query({
	prompt: "What was the secret word? Also, how many times have I asked you about it?",
	options: {
		allowedTools: [],
		resume: sessionId,
	},
})) {
	if (message.type === "result") {
		finalText = message.result as string;
	}
}

console.log(`Response: ${finalText.slice(0, 300)}`);

await step("DONE — All 3 steps completed successfully");
