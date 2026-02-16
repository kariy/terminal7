import { createHash, randomBytes } from "crypto";

export function nowMs(): number {
	return Date.now();
}

export function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1)}…`;
}

export function encodeCwd(cwd: string): string {
	return cwd.replace(/\//g, "-");
}

// Claude encodes cwd by replacing `/` with `-`.
// This is not perfectly reversible when the path contains `-`, but it is
// still useful for deriving a likely path for externally-created sessions.
export function decodeEncodedCwd(encodedCwd: string): string {
	if (!encodedCwd.startsWith("-")) return encodedCwd;
	return encodedCwd.replace(/-/g, "/");
}

export function createToken(byteLength = 32): string {
	return randomBytes(byteLength).toString("base64url");
}

export function createSalt(byteLength = 16): string {
	return randomBytes(byteLength).toString("hex");
}

export function hashWithSalt(value: string, salt: string): string {
	return createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

export function extractTextBlocks(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.filter((entry) => typeof entry === "object" && entry !== null)
		.map((entry) => {
			const block = entry as { type?: string; text?: string };
			if (block.type === "text" && typeof block.text === "string") {
				return block.text;
			}
			return "";
		})
		.join("");
}
