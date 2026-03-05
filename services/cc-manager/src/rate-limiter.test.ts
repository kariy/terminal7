import { describe, test, expect, afterEach } from "bun:test";
import { LoginRateLimiter } from "./rate-limiter";

describe("LoginRateLimiter", () => {
	let limiter: LoginRateLimiter;

	afterEach(() => {
		limiter?.dispose();
	});

	test("allows requests under the limit", () => {
		limiter = new LoginRateLimiter(60_000, 3);
		limiter.recordFailure("1.2.3.4");
		limiter.recordFailure("1.2.3.4");
		expect(limiter.check("1.2.3.4").allowed).toBe(true);
	});

	test("blocks after max attempts reached", () => {
		limiter = new LoginRateLimiter(60_000, 3);
		limiter.recordFailure("1.2.3.4");
		limiter.recordFailure("1.2.3.4");
		limiter.recordFailure("1.2.3.4");
		const result = limiter.check("1.2.3.4");
		expect(result.allowed).toBe(false);
		expect(result.retryAfterMs).toBeGreaterThan(0);
	});

	test("reset clears the counter", () => {
		limiter = new LoginRateLimiter(60_000, 2);
		limiter.recordFailure("1.2.3.4");
		limiter.recordFailure("1.2.3.4");
		expect(limiter.check("1.2.3.4").allowed).toBe(false);
		limiter.reset("1.2.3.4");
		expect(limiter.check("1.2.3.4").allowed).toBe(true);
	});

	test("different IPs are tracked independently", () => {
		limiter = new LoginRateLimiter(60_000, 1);
		limiter.recordFailure("1.1.1.1");
		expect(limiter.check("1.1.1.1").allowed).toBe(false);
		expect(limiter.check("2.2.2.2").allowed).toBe(true);
	});

	test("unknown IP is always allowed", () => {
		limiter = new LoginRateLimiter(60_000, 5);
		expect(limiter.check("9.9.9.9").allowed).toBe(true);
	});

	test("window expiry resets the counter", () => {
		// Use a tiny window of 1ms
		limiter = new LoginRateLimiter(1, 1);
		limiter.recordFailure("1.2.3.4");
		// After the window, the entry should be expired
		const start = Date.now();
		while (Date.now() - start < 5) {
			// busy wait past the 1ms window
		}
		expect(limiter.check("1.2.3.4").allowed).toBe(true);
	});
});
