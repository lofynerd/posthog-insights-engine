jest.mock("../src/services/posthog.service", () => ({
    runHogQL: jest.fn(),
}));

const posthog = require("../src/services/posthog.service");
const geography = require("../src/metrics/geography");

describe("Geography Metrics - Distinct Audience Growth", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("calculates distinct person growth correctly", async () => {
        posthog.runHogQL.mockImplementation((query) => {
            if (query.includes("unique_people")) {
                // First half: timestamp >= now() - INTERVAL 30 DAY AND timestamp < now() - INTERVAL 15 DAY
                if (query.includes("INTERVAL 30 DAY") && query.includes("< now() - INTERVAL 15 DAY")) {
                    return Promise.resolve({ results: [[100]] }); // First half
                }
                // Second half: timestamp >= now() - INTERVAL 15 DAY (no AND clause)
                else if (query.includes("INTERVAL 15 DAY") && !query.includes("< now()")) {
                    return Promise.resolve({ results: [[120]] }); // Second half
                }
            }
            return Promise.resolve({ results: [] });
        });

        const result = await geography.collect(30, 0);

        // Growth: (120 - 100) / 100 = 20%
        expect(result.distinctAudienceGrowthPct).toBe(20);
        expect(result.firstHalfDistinctAudience).toBe(100);
        expect(result.secondHalfDistinctAudience).toBe(120);
    });

    it("handles the same person across multiple days correctly", async () => {
        // One person visiting every day should count as 1 in each half, not sum of daily counts
        posthog.runHogQL.mockImplementation((query) => {
            if (query.includes("unique_people")) {
                return Promise.resolve({ results: [[1]] }); // Same person both halves
            }
            if (query.includes("daily_active_users")) {
                // Daily series shows them active every day
                return Promise.resolve({
                    results: [
                        ["2026-09-01", 1],
                        ["2026-09-02", 1],
                        ["2026-09-03", 1],
                        // ... etc
                    ],
                });
            }
            return Promise.resolve({ results: [] });
        });

        const result = await geography.collect(30, 0);

        // No growth: same 1 person in both halves
        expect(result.distinctAudienceGrowthPct).toBe(0);
        expect(result.firstHalfDistinctAudience).toBe(1);
        expect(result.secondHalfDistinctAudience).toBe(1);
        
        // But daily activity shows repeated visits
        expect(result.dailyActivitySeries.length).toBeGreaterThan(0);
    });

    it("measures reach expansion not activity frequency", async () => {
        posthog.runHogQL.mockImplementation((query) => {
            if (query.includes("unique_people")) {
                // First half: 50 people, Second half: 50 people (no new people reached)
                return Promise.resolve({ results: [[50]] });
            }
            return Promise.resolve({ results: [] });
        });

        const result = await geography.collect(30, 0);

        // 0% growth despite potentially high activity
        expect(result.distinctAudienceGrowthPct).toBe(0);
    });

    it("handles declining audience", async () => {
        posthog.runHogQL.mockImplementation((query) => {
            if (query.includes("unique_people")) {
                if (query.includes("INTERVAL 30 DAY") && query.includes("< now() - INTERVAL 15 DAY")) {
                    return Promise.resolve({ results: [[200]] }); // First half
                } else if (query.includes("INTERVAL 15 DAY") && !query.includes("< now()")) {
                    return Promise.resolve({ results: [[150]] }); // Second half declined
                }
            }
            return Promise.resolve({ results: [] });
        });

        const result = await geography.collect(30, 0);

        // Negative growth: (150 - 200) / 200 = -25%
        expect(result.distinctAudienceGrowthPct).toBe(-25);
    });

    it("handles zero first half safely", async () => {
        posthog.runHogQL.mockImplementation((query) => {
            if (query.includes("unique_people")) {
                if (query.includes("INTERVAL 15 DAY")) {
                    return Promise.resolve({ results: [[0]] }); // No audience first half
                } else {
                    return Promise.resolve({ results: [[10]] }); // Some audience second half
                }
            }
            return Promise.resolve({ results: [] });
        });

        const result = await geography.collect(30, 0);

        // Can't calculate growth from zero baseline
        expect(result.distinctAudienceGrowthPct).toBeNull();
    });

    it("handles zero both halves", async () => {
        posthog.runHogQL.mockImplementation((query) => {
            if (query.includes("unique_people")) {
                return Promise.resolve({ results: [[0]] });
            }
            return Promise.resolve({ results: [] });
        });

        const result = await geography.collect(30, 0);

        expect(result.distinctAudienceGrowthPct).toBeNull();
        expect(result.firstHalfDistinctAudience).toBe(0);
        expect(result.secondHalfDistinctAudience).toBe(0);
    });

    it("preserves daily activity series for visualization", async () => {
        posthog.runHogQL.mockImplementation((query) => {
            if (query.includes("unique_people")) {
                return Promise.resolve({ results: [[100]] });
            }
            if (query.includes("daily_active_users")) {
                return Promise.resolve({
                    results: [
                        ["2026-09-01", 10],
                        ["2026-09-02", 15],
                        ["2026-09-03", 12],
                    ],
                });
            }
            return Promise.resolve({ results: [] });
        });

        const result = await geography.collect(30, 0);

        expect(result.dailyActivitySeries).toEqual([
            { day: "2026-09-01", dailyActiveUsers: 10 },
            { day: "2026-09-02", dailyActiveUsers: 15 },
            { day: "2026-09-03", dailyActiveUsers: 12 },
        ]);
    });

    it("preserves other geography metrics", async () => {
        posthog.runHogQL.mockImplementation((query) => {
            if (query.includes("unique_people")) {
                return Promise.resolve({ results: [[100]] });
            }
            if (query.includes("country")) {
                return Promise.resolve({
                    results: [
                        ["United States", 50],
                        ["Canada", 30],
                    ],
                });
            }
            if (query.includes("$pathname")) {
                return Promise.resolve({
                    results: [["/home", 100, 75]],
                });
            }
            if (query.includes("referring_domain")) {
                return Promise.resolve({
                    results: [["google.com", 45]],
                });
            }
            return Promise.resolve({ results: [] });
        });

        const result = await geography.collect(30, 0);

        expect(result.topCountries).toHaveLength(2);
        expect(result.topContent).toHaveLength(1);
        expect(result.referralSources).toHaveLength(1);
    });
});
