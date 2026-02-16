const isColorEnabled = (() => {
	if (process.env.NO_COLOR) return false;
	if (process.env.FORCE_COLOR === "0") return false;
	if (process.env.FORCE_COLOR) return true;
	return !!process.stdout?.isTTY;
})();

function colorize(text: string, code: number): string {
	if (!isColorEnabled) return text;
	return `\x1b[${code}m${text}\x1b[0m`;
}

function logScope(scope: string, colorCode: number, message: string): void {
	console.log(`${colorize(`[${scope}]`, colorCode)} ${message}`);
}

export const log = {
	index(message: string) {
		logScope("index", 36, message);
	},
	ws(message: string) {
		logScope("ws", 35, message);
	},
	wsRecv(message: string) {
		logScope("ws:recv", 34, message);
	},
	wsSend(message: string) {
		logScope("ws:send", 33, message);
	},
	session(message: string) {
		logScope("session", 32, message);
	},
	startup(message: string) {
		logScope("startup", 96, message);
	},
};
