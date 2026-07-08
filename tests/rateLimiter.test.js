const { RateLimiter } = require("../src/utils/rateLimiter");

describe("RateLimiter", () => {
    it("allows requests under the limit", () => {
        const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });

        expect(limiter.check("chat1").allowed).toBe(true);
        expect(limiter.check("chat1").allowed).toBe(true);
        expect(limiter.check("chat1").allowed).toBe(true);
    });

    it("blocks requests once the limit is exceeded", () => {
        const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });

        limiter.check("chat1");
        limiter.check("chat1");
        const third = limiter.check("chat1");

        expect(third.allowed).toBe(false);
        expect(third.retryAfterMs).toBeGreaterThan(0);
    });

    it("tracks limits independently per key", () => {
        const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });

        expect(limiter.check("chat1").allowed).toBe(true);
        expect(limiter.check("chat2").allowed).toBe(true);
        expect(limiter.check("chat1").allowed).toBe(false);
    });

    it("allows requests again after the window expires", () => {
        jest.useFakeTimers();
        const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });

        expect(limiter.check("chat1").allowed).toBe(true);
        expect(limiter.check("chat1").allowed).toBe(false);

        jest.advanceTimersByTime(1001);

        expect(limiter.check("chat1").allowed).toBe(true);
        jest.useRealTimers();
    });

    it("sweep() removes stale keys without throwing", () => {
        const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1 });
        limiter.check("chat1");
        expect(() => limiter.sweep()).not.toThrow();
    });
});
