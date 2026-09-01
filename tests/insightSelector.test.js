const { selectInsight, METRIC_INSIGHT_MAP, DEFAULT_INSIGHT_BY_AUDIENCE } = require("../src/insights/insightSelector");

describe("selectInsight", () => {
    it("picks the metric with the largest absolute % change, in scope for the audience", () => {
        const current = {
            acquisition: { uniqueVisitors: 120, pageviews: 300 },
            engagement: { bounceRate: 0.31 },
        };
        const previous = {
            acquisition: { uniqueVisitors: 100, pageviews: 290 }, // +20%, +3.4%
            engagement: { bounceRate: 0.3 }, // +3.3%
        };

        const result = selectInsight(current, previous, "marketing");

        expect(result.metricKey).toBe("uniqueVisitors");
        expect(result.changePct).toBe(20);
        expect(result.isFallback).toBe(false);
    });

    it("only considers metrics in scope for the requested audience", () => {
        const current = { conversion: { revenue: 200 }, acquisition: { uniqueVisitors: 105 } };
        const previous = { conversion: { revenue: 100 }, acquisition: { uniqueVisitors: 100 } }; // revenue +100%, visitors +5%

        // "development" doesn't have revenue in scope, so uniqueVisitors (a smaller but in-scope change) wins.
        const result = selectInsight(current, previous, "development");

        expect(result.metricKey).toBe("uniqueVisitors");
    });

    it("falls back to the audience default when nothing moved above the threshold", () => {
        const current = { acquisition: { uniqueVisitors: 101 } };
        const previous = { acquisition: { uniqueVisitors: 100 } }; // +1%, below default 5% threshold

        const result = selectInsight(current, previous, "marketing");

        expect(result.isFallback).toBe(true);
        expect(result.insightId).toBe(DEFAULT_INSIGHT_BY_AUDIENCE.marketing.insightId);
        expect(result.metricKey).toBeNull();
        expect(result.changePct).toBeNull();
    });

    it("falls back when there is no previous period at all", () => {
        const current = { acquisition: { uniqueVisitors: 500 } };

        const result = selectInsight(current, null, "board");

        expect(result.isFallback).toBe(true);
        expect(result.insightId).toBe(DEFAULT_INSIGHT_BY_AUDIENCE.board.insightId);
    });

    it("falls back when relevant metrics are missing from both snapshots", () => {
        const result = selectInsight({}, {}, "development");

        expect(result.isFallback).toBe(true);
        expect(result.insightId).toBe(DEFAULT_INSIGHT_BY_AUDIENCE.development.insightId);
    });

    it("respects a custom minChangePct threshold", () => {
        const current = { acquisition: { uniqueVisitors: 103 } };
        const previous = { acquisition: { uniqueVisitors: 100 } }; // +3%

        expect(selectInsight(current, previous, "marketing", 5).isFallback).toBe(true);
        expect(selectInsight(current, previous, "marketing", 1).isFallback).toBe(false);
    });

    it("picks the larger-magnitude negative change over a smaller positive one", () => {
        const current = { engagement: { bounceRate: 0.6 }, acquisition: { uniqueVisitors: 103 } };
        const previous = { engagement: { bounceRate: 0.3 }, acquisition: { uniqueVisitors: 100 } }; // bounce +100%, visitors +3%

        const result = selectInsight(current, previous, "marketing");

        expect(result.metricKey).toBe("bounceRate");
        expect(result.changePct).toBe(100);
    });

    it("falls back to board's default insight for an unrecognized audience", () => {
        const result = selectInsight({}, {}, "not-a-real-audience");
        expect(result.insightId).toBe(DEFAULT_INSIGHT_BY_AUDIENCE.board.insightId);
    });

    it("every metric map entry has a valid, positive integer insightId", () => {
        METRIC_INSIGHT_MAP.forEach((entry) => {
            expect(Number.isInteger(entry.insightId)).toBe(true);
            expect(entry.insightId).toBeGreaterThan(0);
        });
    });

    it("every default insight has a valid, positive integer insightId", () => {
        Object.values(DEFAULT_INSIGHT_BY_AUDIENCE).forEach((entry) => {
            expect(Number.isInteger(entry.insightId)).toBe(true);
            expect(entry.insightId).toBeGreaterThan(0);
        });
    });
});
