/**
 * WebSocket client that connects to the server, sends a message,
 * disconnects, then reconnects to verify it receives the full history.
 */

const SERVER_URL = "ws://localhost:3000/ws";

function connect(): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(SERVER_URL);
		ws.addEventListener("open", () => resolve(ws));
		ws.addEventListener("error", (e) => reject(e));
	});
}

function waitForMessages(
	ws: WebSocket,
	until: (msg: any) => boolean,
): Promise<any[]> {
	return new Promise((resolve) => {
		const collected: any[] = [];
		ws.addEventListener("message", (event) => {
			const msg = JSON.parse(String(event.data));
			collected.push(msg);
			if (until(msg)) resolve(collected);
		});
	});
}

function step(label: string) {
	console.log(`\n${"=".repeat(60)}`);
	console.log(`  ${label}`);
	console.log(`${"=".repeat(60)}\n`);
}

// ── Step 1: Connect and send a message ──────────────────────
step("Step 1: Connect and send a message");

const ws1 = await connect();
console.log("Connected");

const msgs1Promise = waitForMessages(ws1, (m) => m.type === "done");
ws1.send(JSON.stringify({ prompt: "Remember the code word: MANGO. Just confirm." }));

const msgs1 = await msgs1Promise;
const deltas1 = msgs1.filter((m) => m.type === "delta").map((m) => m.text).join("");
console.log(`Response: ${deltas1.slice(0, 200)}`);

// ── Step 2: Send a second message ───────────────────────────
step("Step 2: Send a second message");

const msgs2Promise = waitForMessages(ws1, (m) => m.type === "done");
ws1.send(JSON.stringify({ prompt: "What's the code word?" }));

const msgs2 = await msgs2Promise;
const deltas2 = msgs2.filter((m) => m.type === "delta").map((m) => m.text).join("");
console.log(`Response: ${deltas2.slice(0, 200)}`);

// ── Step 3: Disconnect ──────────────────────────────────────
step("Step 3: Disconnect");
ws1.close();
console.log("Disconnected");

// Small delay to let close propagate
await new Promise((r) => setTimeout(r, 500));

// ── Step 4: Reconnect and check history ─────────────────────
step("Step 4: Reconnect — checking history");

const ws2 = await connect();
console.log("Reconnected");

// Wait briefly for the server to send history on open
const historyMsgs = await new Promise<any[]>((resolve) => {
	const collected: any[] = [];
	const timeout = setTimeout(() => resolve(collected), 3000);

	ws2.addEventListener("message", (event) => {
		const msg = JSON.parse(String(event.data));
		collected.push(msg);
		if (msg.type === "history") {
			clearTimeout(timeout);
			// Give a small buffer in case more messages come
			setTimeout(() => resolve(collected), 200);
		}
	});
});

const historyMsg = historyMsgs.find((m) => m.type === "history");

if (!historyMsg) {
	console.error("FAILED: No history message received on reconnect");
	ws2.close();
	process.exit(1);
}

console.log(`Received ${historyMsg.messages.length} messages in history:\n`);
for (const msg of historyMsg.messages) {
	const preview = msg.text.slice(0, 100).replace(/\n/g, " ");
	console.log(`  [${msg.role}] ${preview}`);
}

ws2.close();

step("DONE");
