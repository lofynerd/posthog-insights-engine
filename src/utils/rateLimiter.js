/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Protects AI credits from being drained by chatty group members
 * spamming the Q&A command. In-memory is a deliberate tradeoff: this
 * process is a single long-lived bot instance (not a fleet of Lambda
 * invocations), so a per-process limiter is sufficient without
 * needing a shared store like DynamoDB/Redis. If this ever moves to
 * a multi-instance deployment, replace with a shared store.
 */
class RateLimiter {
    constructor({ maxRequests, windowMs }) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.hits = new Map(); // key -> array of timestamps
    }

    /**
     * @param {string} key - Usually a chat ID or user ID.
     * @returns {{ allowed: boolean, retryAfterMs: number }}
     */
    check(key) {
        const now = Date.now();
        const timestamps = (this.hits.get(key) || []).filter(
            (ts) => now - ts < this.windowMs
        );

        if (timestamps.length >= this.maxRequests) {
            const oldest = timestamps[0];
            const retryAfterMs = this.windowMs - (now - oldest);
            this.hits.set(key, timestamps);
            return { allowed: false, retryAfterMs };
        }

        timestamps.push(now);
        this.hits.set(key, timestamps);
        return { allowed: true, retryAfterMs: 0 };
    }

    /**
     * Periodic cleanup to prevent unbounded memory growth from
     * one-off chat IDs that never come back.
     */
    sweep() {
        const now = Date.now();
        for (const [key, timestamps] of this.hits.entries()) {
            const fresh = timestamps.filter((ts) => now - ts < this.windowMs);
            if (fresh.length === 0) {
                this.hits.delete(key);
            } else {
                this.hits.set(key, fresh);
            }
        }
    }
}

module.exports = { RateLimiter };
