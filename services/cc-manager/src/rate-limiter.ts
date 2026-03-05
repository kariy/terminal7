export interface RateLimitResult {
	allowed: boolean;
	retryAfterMs?: number;
}

export class LoginRateLimiter {
	private entries = new Map<string, { count: number; windowStart: number }>();
	private cleanupTimer: ReturnType<typeof setInterval>;

	constructor(
		private windowMs: number,
		private maxAttempts: number,
	) {
		this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
	}

	check(ip: string): RateLimitResult {
		const entry = this.entries.get(ip);
		if (!entry) return { allowed: true };

		const now = Date.now();
		const elapsed = now - entry.windowStart;
		if (elapsed >= this.windowMs) {
			this.entries.delete(ip);
			return { allowed: true };
		}

		if (entry.count >= this.maxAttempts) {
			return {
				allowed: false,
				retryAfterMs: this.windowMs - elapsed,
			};
		}

		return { allowed: true };
	}

	recordFailure(ip: string): void {
		const now = Date.now();
		const entry = this.entries.get(ip);
		if (!entry || now - entry.windowStart >= this.windowMs) {
			this.entries.set(ip, { count: 1, windowStart: now });
		} else {
			entry.count++;
		}
	}

	reset(ip: string): void {
		this.entries.delete(ip);
	}

	dispose(): void {
		clearInterval(this.cleanupTimer);
		this.entries.clear();
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [ip, entry] of this.entries) {
			if (now - entry.windowStart >= this.windowMs) {
				this.entries.delete(ip);
			}
		}
	}
}
