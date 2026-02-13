import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

let sessionId: string | undefined;

function readSessionHistory(): Array<{ role: "user" | "assistant"; text: string }> {
	if (!sessionId) return [];
	try {
		const cwd = process.cwd();
		const encodedCwd = cwd.replace(/\//g, "-");
		const sessionPath = join(
			homedir(),
			".claude",
			"projects",
			encodedCwd,
			`${sessionId}.jsonl`,
		);
		const lines = readFileSync(sessionPath, "utf-8").split("\n").filter(Boolean);
		const messages: Array<{ role: "user" | "assistant"; text: string }> = [];
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
				messages.push({ role: "user", text });
			} else if (entry.type === "assistant" && entry.message) {
				const text = entry.message.content
					.filter((b: any) => b.type === "text")
					.map((b: any) => b.text)
					.join("");
				messages.push({ role: "assistant", text });
			}
		}
		return messages;
	} catch {
		return [];
	}
}

const server = Bun.serve({
	hostname: "0.0.0.0",
	port: 3000,
	async fetch(req, server) {
		const url = new URL(req.url);

		if (url.pathname === "/ws") {
			if (server.upgrade(req)) return;
			return new Response("WebSocket upgrade failed", { status: 400 });
		}

		if (url.pathname === "/") {
			return new Response(Bun.file("public/index.html"));
		}

		return new Response("Not found", { status: 404 });
	},
	websocket: {
		open(ws) {
			console.log(`[ws] Connection opened from ${ws.remoteAddress}`);
			const history = readSessionHistory();
			if (history.length > 0) {
				ws.send(JSON.stringify({ type: "history", messages: history }));
			}
		},
		async message(ws, raw) {
			let parsed: any;
			try {
				parsed = JSON.parse(String(raw));
			} catch {
				ws.send(
					JSON.stringify({ type: "error", text: "Invalid message" }),
				);
				return;
			}

			if (parsed.type === "refresh") {
				const history = readSessionHistory();
				ws.send(JSON.stringify({ type: "history", messages: history }));
				return;
			}

			const prompt: string = parsed.prompt;
			if (!prompt) {
				ws.send(
					JSON.stringify({ type: "error", text: "Missing prompt" }),
				);
				return;
			}

			let assistantText = "";

			try {
				for await (const message of query({
					prompt,
					options: {
						allowedTools: ["Read", "Glob", "Grep", "Bash"],
						includePartialMessages: true,
						...(sessionId && { resume: sessionId }),
					},
				})) {
					if (
						message.type === "system" &&
						message.subtype === "init"
					) {
						sessionId = message.session_id;
						console.log(`[session] ${sessionId}`);
					}

					if (message.type === "stream_event") {
						const { event } = message;
						if (
							event.type === "content_block_delta" &&
							event.delta.type === "text_delta"
						) {
							assistantText += event.delta.text;
							ws.send(
								JSON.stringify({
									type: "delta",
									text: event.delta.text,
								}),
							);
						}
					}

					if (message.type === "result") {
						ws.send(JSON.stringify({ type: "done" }));
					}
				}
			} catch (err) {
				console.error("[error]", err);
				ws.send(
					JSON.stringify({
						type: "error",
						text: String(err),
					}),
				);
			}
		},
	},
});

console.log(`Server running at http://${server.hostname}:${server.port}`);
