const {
    getMetricPriority,
    prioritizeMetrics,
    buildPersonaGuidance,
    filterObservationsForPersona,
} = require("../src/insights/personaPriority");

describe("Persona Priority", () => {
    describe("getMetricPriority", () => {
        it("returns high priority for board revenue metrics", () => {
            expect(getMetricPriority("board", "revenue")).toBe(10);
            expect(getMetricPriority("board", "conversionRate")).toBe(9);
            expect(getMetricPriority("board", "healthScore")).toBe(10);
        });

        it("returns low priority for board technical metrics", () => {
            expect(getMetricPriority("board", "webVitals")).toBe(3);
            expect(getMetricPriority("board", "browserBreakdown")).toBe(2);
        });

        it("returns high priority for PR audience metrics", () => {
            expect(getMetricPriority("pr", "distinctAudienceGrowthPct")).toBe(10);
            expect(getMetricPriority("pr", "referralSources")).toBe(10);
            expect(getMetricPriority("pr", "topContent")).toBe(9);
        });

        it("returns low priority for PR conversion metrics", () => {
            expect(getMetricPriority("pr", "conversionRate")).toBe(5);
            expect(getMetricPriority("pr", "revenue")).toBe(4);
        });

        it("returns high priority for development technical metrics", () => {
            expect(getMetricPriority("development", "webVitals")).toBe(10);
            expect(getMetricPriority("development", "rageClicks")).toBe(10);
            expect(getMetricPriority("development", "deviceBreakdown")).toBe(9);
        });

        it("returns low priority for development marketing metrics", () => {
            expect(getMetricPriority("development", "topUtmSources")).toBe(2);
            expect(getMetricPriority("development", "revenue")).toBe(3);
        });

        it("returns default for unknown persona", () => {
            expect(getMetricPriority("unknown", "revenue")).toBe(5);
        });

        it("returns default for unknown metric", () => {
            expect(getMetricPriority("board", "unknownMetric")).toBe(5);
        });
    });

    describe("prioritizeMetrics", () => {
        it("prioritizes board metrics correctly", () => {
            const metrics = {
                acquisition: { uniqueVisitors: 100 },
                conversion: { revenue: 1000, conversionRate: 0.02 },
                engagement: { webVitals: {} },
            };

            const prioritized = prioritizeMetrics("board", metrics);

            // Revenue should be higher priority than webVitals for board
            const revenueIdx = prioritized.findIndex((m) => m.key === "revenue");
            const webVitalsIdx = prioritized.findIndex((m) => m.key === "webVitals");

            expect(revenueIdx).toBeLessThan(webVitalsIdx);
            expect(prioritized[revenueIdx].priority).toBeGreaterThan(prioritized[webVitalsIdx].priority);
        });

        it("prioritizes PR metrics correctly", () => {
            const metrics = {
                acquisition: { uniqueVisitors: 100 },
                geography: { distinctAudienceGrowthPct: 10, referralSources: [] },
                conversion: { revenue: 1000 },
            };

            const prioritized = prioritizeMetrics("pr", metrics);

            // Audience growth should be higher priority than revenue for PR
            const audienceIdx = prioritized.findIndex((m) => m.key === "distinctAudienceGrowthPct");
            const revenueIdx = prioritized.findIndex((m) => m.key === "revenue");

            expect(audienceIdx).toBeLessThan(revenueIdx);
        });

        it("returns empty array for unknown persona", () => {
            const metrics = { acquisition: { uniqueVisitors: 100 } };
            const prioritized = prioritizeMetrics("unknown", metrics);
            expect(prioritized).toEqual([]);
        });
    });

    describe("buildPersonaGuidance", () => {
        it("provides board-specific guidance", () => {
            const guidance = buildPersonaGuidance("board");

            expect(guidance).toContain("Board/Executive");
            expect(guidance).toContain("Revenue, conversion, and growth");
            expect(guidance).toContain("Strategic recommendations");
            expect(guidance).toContain("DEPRIORITIZE");
            expect(guidance).toContain("Technical implementation details");
        });

        it("provides PR-specific guidance", () => {
            const guidance = buildPersonaGuidance("pr");

            expect(guidance).toContain("PR/Communications");
            expect(guidance).toContain("Audience reach and growth");
            expect(guidance).toContain("Referral sources");
            expect(guidance).toContain("who's talking about us");
            expect(guidance).toContain("DEPRIORITIZE");
            expect(guidance).toContain("Conversion funnel and revenue");
        });

        it("provides development-specific guidance", () => {
            const guidance = buildPersonaGuidance("development");

            expect(guidance).toContain("Development/Engineering");
            expect(guidance).toContain("Technical performance");
            expect(guidance).toContain("rage clicks");
            expect(guidance).toContain("UX friction");
            expect(guidance).toContain("DEPRIORITIZE");
            expect(guidance).toContain("Marketing campaigns");
        });

        it("provides marketing-specific guidance", () => {
            const guidance = buildPersonaGuidance("marketing");

            expect(guidance).toContain("Marketing");
            expect(guidance).toContain("Traffic acquisition");
            expect(guidance).toContain("Conversion funnel");
            expect(guidance).toContain("Campaign ROI");
        });

        it("defaults to board guidance for unknown persona", () => {
            const guidance = buildPersonaGuidance("unknown");
            expect(guidance).toContain("Board/Executive");
        });
    });

    describe("filterObservationsForPersona", () => {
        it("PR persona filters out conversion funnel observations", () => {
            const observations = [
                { type: "CONVERSION_RATE_CHANGE", metric: "conversion", evidenceStrength: "SUPPORTED" },
                { type: "AUDIENCE_GROWTH_CHANGE", metric: "geography", evidenceStrength: "SUPPORTED" },
                { type: "VISITOR_COMPOSITION", metric: "acquisition", evidenceStrength: "SUPPORTED" },
            ];

            const filtered = filterObservationsForPersona(observations, "pr");

            // PR should see audience growth and visitor composition, but not conversion rate
            expect(filtered.some((o) => o.type === "AUDIENCE_GROWTH_CHANGE")).toBe(true);
            expect(filtered.some((o) => o.type === "VISITOR_COMPOSITION")).toBe(true);
            expect(filtered.some((o) => o.type === "CONVERSION_RATE_CHANGE")).toBe(false);
        });

        it("development persona filters out acquisition observations", () => {
            const observations = [
                { type: "BOUNCE_RATE_CHANGE", metric: "engagement", evidenceStrength: "SUPPORTED" },
                { type: "VISITOR_COMPOSITION", metric: "acquisition", evidenceStrength: "SUPPORTED" },
            ];

            const filtered = filterObservationsForPersona(observations, "development");

            // Development should see bounce rate, not visitor composition
            expect(filtered.some((o) => o.type === "BOUNCE_RATE_CHANGE")).toBe(true);
            expect(filtered.some((o) => o.type === "VISITOR_COMPOSITION")).toBe(false);
        });

        it("always includes critical observations", () => {
            const observations = [
                { type: "CHECKOUT_WITHOUT_PURCHASE", metric: "conversion", evidenceStrength: "SUPPORTED" },
                { type: "VISITOR_COMPOSITION", metric: "acquisition", evidenceStrength: "SUPPORTED" },
            ];

            const filtered = filterObservationsForPersona(observations, "pr");

            // Critical checkout issue should be shown even to PR
            expect(filtered.some((o) => o.type === "CHECKOUT_WITHOUT_PURCHASE")).toBe(true);
        });

        it("board persona sees all observations", () => {
            const observations = [
                { type: "CONVERSION_RATE_CHANGE", metric: "conversion", evidenceStrength: "SUPPORTED" },
                { type: "BOUNCE_RATE_CHANGE", metric: "engagement", evidenceStrength: "SUPPORTED" },
                { type: "AUDIENCE_GROWTH_CHANGE", metric: "geography", evidenceStrength: "SUPPORTED" },
            ];

            const filtered = filterObservationsForPersona(observations, "board");

            // Board should see everything
            expect(filtered).toHaveLength(observations.length);
        });
    });
});
