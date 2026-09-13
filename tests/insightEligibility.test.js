const {
    checkSampleSize,
    checkComparisonAvailability,
    checkMaterialChanges,
    checkConversionFunnelValidity,
    checkObservationEligibility,
    checkReportEligibility,
} = require("../src/insights/insightEligibility");

describe("Insight Eligibility", () => {
    describe("checkSampleSize", () => {
        it("passes with sufficient sample size", () => {
            const metrics = {
                acquisition: { uniqueVisitors: 100, pageviews: 500 },
                engagement: { totalSessions: 150 },
            };

            const result = checkSampleSize(metrics);
            expect(result.eligible).toBe(true);
            expect(result.reason).toBeNull();
        });

        it("fails with insufficient sample size", () => {
            const metrics = {
                acquisition: { uniqueVisitors: 2, pageviews: 5 },
                engagement: { totalSessions: 3 },
            };

            const result = checkSampleSize(metrics);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain("Insufficient sample size");
        });

        it("handles missing metrics", () => {
            const metrics = {};

            const result = checkSampleSize(metrics);
            expect(result.eligible).toBe(false);
        });
    });

    describe("checkComparisonAvailability", () => {
        it("passes with valid comparison", () => {
            const comparison = { hasBaseline: true, changes: {} };

            const result = checkComparisonAvailability(comparison);
            expect(result.eligible).toBe(true);
        });

        it("fails without baseline", () => {
            const comparison = { hasBaseline: false };

            const result = checkComparisonAvailability(comparison);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain("No previous period data");
        });

        it("fails with null comparison", () => {
            const result = checkComparisonAvailability(null);
            expect(result.eligible).toBe(false);
        });
    });

    describe("checkMaterialChanges", () => {
        it("identifies material changes above threshold", () => {
            const comparison = {
                hasBaseline: true,
                changes: {
                    conversionRateChangePct: 15.5,
                    bounceRateChangePct: 2.3,
                    uniqueVisitorsChangePct: -8.7,
                },
            };

            const result = checkMaterialChanges(comparison, 5);

            expect(result.eligible).toBe(true);
            expect(result.materialChanges).toHaveLength(2); // 15.5 and -8.7
            expect(result.materialChanges[0].changePct).toBe(15.5);
        });

        it("returns empty for no material changes", () => {
            const comparison = {
                hasBaseline: true,
                changes: {
                    conversionRateChangePct: 2,
                    bounceRateChangePct: -3,
                },
            };

            const result = checkMaterialChanges(comparison, 5);

            expect(result.eligible).toBe(true);
            expect(result.materialChanges).toHaveLength(0);
        });

        it("handles no comparison gracefully", () => {
            const result = checkMaterialChanges(null);

            expect(result.eligible).toBe(true);
            expect(result.materialChanges).toHaveLength(0);
        });
    });

    describe("checkConversionFunnelValidity", () => {
        it("passes with valid conversion data", () => {
            const metrics = {
                conversion: {
                    uniqueVisitors: 100,
                    uniquePurchasers: 5,
                    uniqueProductViewers: 80,
                },
            };

            const result = checkConversionFunnelValidity(metrics);
            expect(result.eligible).toBe(true);
        });

        it("fails with missing conversion data", () => {
            const metrics = {};

            const result = checkConversionFunnelValidity(metrics);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain("No conversion data");
        });

        it("fails with invalid data (purchasers without visitors)", () => {
            const metrics = {
                conversion: {
                    uniqueVisitors: 0,
                    uniquePurchasers: 5,
                },
            };

            const result = checkConversionFunnelValidity(metrics);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain("Invalid conversion data");
        });
    });

    describe("checkObservationEligibility", () => {
        it("always allows critical observations", () => {
            const observation = {
                type: "CHECKOUT_WITHOUT_PURCHASE",
                evidenceStrength: "SUPPORTED",
            };

            const result = checkObservationEligibility(observation);
            expect(result.eligible).toBe(true);
        });

        it("blocks insufficient evidence observations", () => {
            const observation = {
                type: "SOME_PATTERN",
                evidenceStrength: "INSUFFICIENT",
            };

            const result = checkObservationEligibility(observation);
            expect(result.eligible).toBe(false);
            expect(result.reason).toContain("Evidence strength is insufficient");
        });

        it("allows plausible observations with warning", () => {
            const observation = {
                type: "SOME_PATTERN",
                evidenceStrength: "PLAUSIBLE",
            };

            const result = checkObservationEligibility(observation);
            expect(result.eligible).toBe(true);
            expect(result.reason).toContain("hedged");
        });

        it("allows supported observations", () => {
            const observation = {
                type: "CONVERSION_RATE_CHANGE",
                evidenceStrength: "SUPPORTED",
            };

            const result = checkObservationEligibility(observation);
            expect(result.eligible).toBe(true);
        });
    });

    describe("checkReportEligibility", () => {
        it("passes comprehensive check with good data", () => {
            const metrics = {
                acquisition: { uniqueVisitors: 100, pageviews: 500 },
                engagement: { totalSessions: 150 },
                conversion: { uniqueVisitors: 100, uniquePurchasers: 5 },
            };

            const comparison = {
                hasBaseline: true,
                changes: {
                    conversionRateChangePct: 10,
                },
            };

            const evidence = {
                observations: [
                    {
                        type: "CONVERSION_RATE_CHANGE",
                        evidenceStrength: "SUPPORTED",
                    },
                ],
            };

            const result = checkReportEligibility(metrics, comparison, evidence);

            expect(result.eligible).toBe(true);
            expect(result.issues).toHaveLength(0);
            expect(result.eligibleObservations).toHaveLength(1);
        });

        it("fails with insufficient sample size", () => {
            const metrics = {
                acquisition: { uniqueVisitors: 2 },
            };

            const result = checkReportEligibility(metrics, null, null);

            expect(result.eligible).toBe(false);
            expect(result.issues.length).toBeGreaterThan(0);
            expect(result.issues[0]).toContain("Insufficient sample size");
        });

        it("filters out insufficient evidence observations", () => {
            const metrics = {
                acquisition: { uniqueVisitors: 100, pageviews: 500 },
                engagement: { totalSessions: 150 },
            };

            const evidence = {
                observations: [
                    {
                        type: "PATTERN_A",
                        evidenceStrength: "SUPPORTED",
                    },
                    {
                        type: "PATTERN_B",
                        evidenceStrength: "INSUFFICIENT",
                    },
                ],
            };

            const result = checkReportEligibility(metrics, null, evidence);

            expect(result.eligible).toBe(true);
            expect(result.eligibleObservations).toHaveLength(1);
            expect(result.eligibleObservations[0].type).toBe("PATTERN_A");
            expect(result.warnings.some((w) => w.includes("PATTERN_B"))).toBe(true);
        });
    });
});
