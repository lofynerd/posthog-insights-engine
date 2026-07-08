const {
    safePercentChange,
    compareSnapshots,
    computeHealthScore,
    computeConfidenceScore,
} = require("../src/comparison/compare");

describe("safePercentChange", () => {
    it("computes a positive percentage change", () => {
        expect(safePercentChange(120, 100)).toBe(20);
    });

    it("computes a negative percentage change", () => {
        expect(safePercentChange(80, 100)).toBe(-20);
    });

    it("returns 0 when both values are 0", () => {
        expect(safePercentChange(0, 0)).toBe(0);
    });

    it("returns null when previous is 0 but current is not (undefined growth)", () => {
        expect(safePercentChange(10, 0)).toBeNull();
    });

    it("returns null for non-numeric input", () => {
        expect(safePercentChange(null, 10)).toBeNull();
        expect(safePercentChange(10, undefined)).toBeNull();
    });
});

describe("compareSnapshots", () => {
    it("reports no baseline when previous is null", () => {
        const result = compareSnapshots({ acquisition: { uniqueVisitors: 10 } }, null);
        expect(result.hasBaseline).toBe(false);
        expect(result.changes).toEqual({});
    });

    it("computes changes across domains when a baseline exists", () => {
        const current = {
            acquisition: { uniqueVisitors: 120, pageviews: 500 },
            conversion: { conversionRate: 0.02 },
            engagement: { bounceRate: 0.3 },
            geography: { audienceGrowthTrendPct: 10 },
        };
        const previous = {
            collectedAt: "2026-01-01T00:00:00.000Z",
            acquisition: { uniqueVisitors: 100, pageviews: 400 },
            conversion: { conversionRate: 0.01 },
            engagement: { bounceRate: 0.4 },
            geography: { audienceGrowthTrendPct: 5 },
        };

        const result = compareSnapshots(current, previous);

        expect(result.hasBaseline).toBe(true);
        expect(result.previousCollectedAt).toBe("2026-01-01T00:00:00.000Z");
        expect(result.changes.uniqueVisitorsChangePct).toBe(20);
        expect(result.changes.pageviewsChangePct).toBe(25);
        expect(result.changes.conversionRateChangePct).toBe(100);
        expect(result.changes.bounceRateChangePct).toBe(-25);
        expect(result.changes.audienceGrowthTrendChangePct).toBe(100);
    });

    it("handles missing nested fields gracefully", () => {
        const result = compareSnapshots({}, {});
        expect(result.hasBaseline).toBe(true);
        expect(result.changes.uniqueVisitorsChangePct).toBeNull();
    });
});

describe("computeHealthScore", () => {
    it("returns a neutral score with no data", () => {
        const { score } = computeHealthScore({});
        expect(score).toBe(50);
    });

    it("increases score for strong conversion and low bounce", () => {
        const { score, notes } = computeHealthScore({
            conversion: { conversionRate: 0.03 },
            engagement: { bounceRate: 0.2 },
            geography: { audienceGrowthTrendPct: 15 },
        });
        expect(score).toBeGreaterThan(50);
        expect(notes).toEqual([]);
    });

    it("decreases score and adds notes for poor metrics", () => {
        const { score, notes } = computeHealthScore({
            conversion: { conversionRate: 0.001 },
            engagement: { bounceRate: 0.7, rageClicks: 20 },
            geography: { audienceGrowthTrendPct: -20 },
        });
        expect(score).toBeLessThan(50);
        expect(notes.length).toBeGreaterThan(0);
    });

    it("clamps score between 0 and 100", () => {
        const { score } = computeHealthScore({
            conversion: { conversionRate: 0 },
            engagement: { bounceRate: 0.9, rageClicks: 1000 },
            geography: { audienceGrowthTrendPct: -90 },
        });
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
    });
});

describe("computeConfidenceScore", () => {
    it("returns 0 for empty metrics", () => {
        expect(computeConfidenceScore({})).toBe(0);
    });

    it("returns a higher score for larger data volume", () => {
        const low = computeConfidenceScore({
            acquisition: { pageviews: 10, uniqueVisitors: 2 },
            engagement: { totalSessions: 2 },
        });
        const high = computeConfidenceScore({
            acquisition: { pageviews: 2000, uniqueVisitors: 200 },
            engagement: { totalSessions: 200 },
        });
        expect(high).toBeGreaterThan(low);
        expect(high).toBeLessThanOrEqual(100);
    });
});
