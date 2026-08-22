const {
    campaignReach,
    campaignPurchases,
    campaignReachAllTime,
    campaignPurchasesAllTime,
} = require("../src/queries/conversion.queries");

/**
 * These four query builders interpolate a slug/code that originates
 * from Telegram bot command arguments (user input), unlike every
 * other value in this query file. This is the one place in the
 * conversion queries module where injection is a real risk, so it
 * gets dedicated tests.
 */
describe("campaign query injection guards", () => {
    const injectionAttempts = [
        "'; DROP TABLE events; --",
        "x' OR '1'='1",
        "a'; SELECT * FROM events WHERE '1'='1",
        "../../etc/passwd",
        "",
        "a".repeat(100),
    ];

    describe("campaignReach", () => {
        it.each(injectionAttempts)("rejects malicious/malformed slug: %s", (badSlug) => {
            expect(() => campaignReach(badSlug, 30, 0)).toThrow(/Invalid campaign slug/);
        });

        it("accepts a valid slug and embeds it unmodified", () => {
            const query = campaignReach("jane-doe", 30, 0);
            expect(query).toContain("properties.utm_campaign = 'jane-doe'");
        });
    });

    describe("campaignPurchases", () => {
        it.each(injectionAttempts)("rejects malicious/malformed code: %s", (badCode) => {
            expect(() => campaignPurchases(badCode, 30, 0)).toThrow(/Invalid promo code/);
        });

        it("accepts a valid code and embeds it unmodified", () => {
            const query = campaignPurchases("JANE10", 30, 0);
            expect(query).toContain("properties.promo_code = 'JANE10'");
        });
    });

    describe("campaignReachAllTime", () => {
        it.each(injectionAttempts)("rejects malicious/malformed slug: %s", (badSlug) => {
            expect(() => campaignReachAllTime(badSlug)).toThrow(/Invalid campaign slug/);
        });

        it("accepts a valid slug", () => {
            const query = campaignReachAllTime("jane-doe");
            expect(query).toContain("properties.utm_campaign = 'jane-doe'");
        });
    });

    describe("campaignPurchasesAllTime", () => {
        it.each(injectionAttempts)("rejects malicious/malformed code: %s", (badCode) => {
            expect(() => campaignPurchasesAllTime(badCode)).toThrow(/Invalid promo code/);
        });

        it("accepts a valid code", () => {
            const query = campaignPurchasesAllTime("JANE10");
            expect(query).toContain("properties.promo_code = 'JANE10'");
        });
    });
});
