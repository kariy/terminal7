import { query } from "@anthropic-ai/claude-agent-sdk";

let sessionId: string | undefined;
const history: Array<{ role: "user" | "assistant"; text: string }> = [];

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
			if (history.length > 0) {
				ws.send(JSON.stringify({ type: "history", messages: history }));
			}
		},
		async message(ws, raw) {
			let prompt: string;
			try {
				const parsed = JSON.parse(String(raw));
				prompt = parsed.prompt;
			} catch {
				ws.send(
					JSON.stringify({ type: "error", text: "Invalid message" }),
				);
				return;
			}

			history.push({ role: "user", text: prompt });
			let assistantText = "";

			try {
				for await (const message of query({
					prompt,
					options: {
						allowedTools: ["Read", "Glob", "Grep", "Bash"],
						includePartialMessages: true,
						...(sessionId && { resume: true, sessionId }),
					},
				})) {
					if (
						message.type === "system" &&
						message.subtype === "init"
					) {
						sessionId = message.sessionId;
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
						history.push({
							role: "assistant",
							text: assistantText,
						});
						ws.send(JSON.stringify({ type: "done" }));
					}
				}
			} catch (err) {
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
