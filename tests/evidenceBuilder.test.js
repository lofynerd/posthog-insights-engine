const {
    buildEvidence,
    buildFacts,
    buildObservations,
    formatPercentage,
    formatNumber,
    formatCurrency,
    isMaterialChange,
    assessEvidenceStrength,
} = require("../src/insights/evidenceBuilder");

describe("Evidence Builder", () => {
    describe("formatPercentage", () => {
        it("formats decimal as percentage", () => {
            expect(formatPercentage(0.6476)).toBe("64.76%");
            expect(formatPercentage(0.05)).toBe("5.00%");
            expect(formatPercentage(1.2345)).toBe("123.45%");
        });

        it("handles null and undefined", () => {
            expect(formatPercentage(null)).toBeNull();
            expect(formatPercentage(undefined)).toBeNull();
        });

        it("supports custom decimal places", () => {
            expect(formatPercentage(0.6476, 1)).toBe("64.8%");
            expect(formatPercentage(0.6476, 0)).toBe("65%");
        });
    });

    describe("formatNumber", () => {
        it("formats numbers with thousands separators", () => {
            expect(formatNumber(1234567)).toBe("1,234,567");
            expect(formatNumber(100)).toBe("100");
        });

        it("handles null and undefined", () => {
            expect(formatNumber(null)).toBeNull();
            expect(formatNumber(undefined)).toBeNull();
        });
    });

    describe("formatCurrency", () => {
        it("formats currency with dollar sign and cents", () => {
            expect(formatCurrency(1234.56)).toBe("$1,234.56");
            expect(formatCurrency(100)).toBe("$100.00");
        });

        it("handles null and undefined", () => {
            expect(formatCurrency(null)).toBeNull();
            expect(formatCurrency(undefined)).toBeNull();
        });
    });

    describe("isMaterialChange", () => {
        it("identifies material changes above threshold", () => {
            expect(isMaterialChange(10)).toBe(true);
            expect(isMaterialChange(-8)).toBe(true);
            expect(isMaterialChange(5)).toBe(true);
        });

        it("identifies non-material changes below threshold", () => {
            expect(isMaterialChange(4)).toBe(false);
            expect(isMaterialChange(-3)).toBe(false);
            expect(isMaterialChange(0)).toBe(false);
        });

        it("handles null", () => {
            expect(isMaterialChange(null)).toBe(false);
        });

        it("respects custom threshold", () => {
            expect(isMaterialChange(8, 10)).toBe(false);
            expect(isMaterialChange(12, 10)).toBe(true);
        });
    });

    describe("assessEvidenceStrength", () => {
        it("returns INSUFFICIENT when no comparison data exists", () => {
            expect(
                assessEvidenceStrength({
                    currentValue: 100,
                    previousValue: null,
                    sampleSize: 100,
                    hasComparison: false,
                })
            ).toBe("INSUFFICIENT");
        });

        it("returns SUPPORTED with good sample size and comparison", () => {
            expect(
                assessEvidenceStrength({
                    currentValue: 100,
                    previousValue: 80,
                    sampleSize: 50,
                    hasComparison: true,
                })
            ).toBe("SUPPORTED");
        });

        it("returns PLAUSIBLE with weak sample size", () => {
            expect(
                assessEvidenceStrength({
                    currentValue: 100,
                    previousValue: 80,
                    sampleSize: 15,
                    hasComparison: true,
                })
            ).toBe("PLAUSIBLE");
        });

        it("returns PLAUSIBLE with missing current value", () => {
            expect(
                assessEvidenceStrength({
                    currentValue: null,
                    previousValue: 80,
                    sampleSize: 100,
                    hasComparison: true,
                })
            ).toBe("PLAUSIBLE");
        });
    });

    describe("buildFacts", () => {
        it("structures facts with formatted values", () => {
            const metrics = {
                acquisition: {
                    uniqueVisitors: 1234,
                    pageviews: 5678,
                    returningVisitorRate: 0.35,
                },
                conversion: {
                    conversionRate: 0.0234,
                    revenue: 12345.67,
                },
                engagement: {
                    bounceRate: 0.6476,
                },
            };

            const context = {
                periodType: "weekly",
                periodLabel: "This Week",
                startDate: "2026-09-07",
                endDate: "2026-09-13",
            };

            const facts = buildFacts(metrics, context);

            expect(facts.period.type).toBe("weekly");
            expect(facts.acquisition.uniqueVisitors.value).toBe(1234);
            expect(facts.acquisition.uniqueVisitors.formatted).toBe("1,234");
            expect(facts.acquisition.returningVisitorRate.formatted).toBe("35.00%");
            expect(facts.conversion.conversionRate.formatted).toBe("2.34%");
            expect(facts.conversion.revenue.formatted).toBe("$12,345.67");
            expect(facts.engagement.bounceRate.formatted).toBe("64.76%");
        });

        it("handles missing metrics gracefully", () => {
            const metrics = {
                acquisition: {
                    uniqueVisitors: 100,
                },
            };

            const context = {
                periodType: "daily",
                periodLabel: "Today",
            };

            const facts = buildFacts(metrics, context);

            expect(facts.acquisition.uniqueVisitors.value).toBe(100);
            expect(facts.conversion).toEqual({});
        });
    });

    describe("buildObservations", () => {
        it("creates checkout-without-purchase observation", () => {
            const facts = {
                conversion: {
                    uniqueCheckoutUsers: { value: 8 },
                    uniquePurchasers: { value: 0 },
                },
            };

            const metrics = {
                conversion: {
                    uniqueCheckoutUsers: 8,
                    uniquePurchasers: 0,
                },
            };

            const comparison = { hasBaseline: true, changes: {} };

            const observations = buildObservations(facts, comparison, metrics);

            const checkoutObs = observations.find((o) => o.type === "CHECKOUT_WITHOUT_PURCHASE");
            expect(checkoutObs).toBeDefined();
            expect(checkoutObs.text).toContain("8 users initiated checkout");
            expect(checkoutObs.text).toContain("0 users completed an order");
            expect(checkoutObs.evidenceStrength).toBe("SUPPORTED");
        });

        it("creates visitor composition observation", () => {
            const facts = {
                acquisition: {
                    uniqueVisitors: { value: 333 },
                    returningVisitors: { value: 150 },
                },
            };
            const metrics = {
                acquisition: {
                    uniqueVisitors: 333,
                    returningVisitors: 150,
                },
            };
            const comparison = { hasBaseline: true, changes: {} };

            const observations = buildObservations(facts, comparison, metrics);

            const visitorObs = observations.find((o) => o.type === "VISITOR_COMPOSITION");
            expect(visitorObs).toBeDefined();
            expect(visitorObs.text).toContain("150 returning visitors");
            expect(visitorObs.text).toContain("183 visitors appeared for the first time");
            expect(visitorObs.facts.newVisitors).toBe(183);
        });

        it("creates material change observations", () => {
            const facts = {};
            const metrics = {
                conversion: {
                    conversionRate: 0.02,
                    uniqueVisitors: 100,
                },
            };
            const comparison = {
                hasBaseline: true,
                changes: {
                    conversionRateChangePct: 15.5,
                },
            };

            const observations = buildObservations(facts, comparison, metrics);

            const changeObs = observations.find((o) => o.type === "CONVERSION_RATE_CHANGE");
            expect(changeObs).toBeDefined();
            expect(changeObs.text).toContain("increased 15.5%");
        });

        it("returns no baseline observation when comparison unavailable", () => {
            const observations = buildObservations({}, null, {});

            expect(observations).toHaveLength(1);
            expect(observations[0].type).toBe("NO_BASELINE");
            expect(observations[0].evidenceStrength).toBe("INSUFFICIENT");
        });
    });

    describe("buildEvidence", () => {
        it("builds complete evidence payload", () => {
            const metrics = {
                collectedAt: "2026-09-13T12:00:00Z",
                acquisition: {
                    uniqueVisitors: 333,
                    returningVisitors: 100,
                },
                conversion: {
                    uniqueCheckoutUsers: 8,
                    uniquePurchasers: 0,
                    conversionRate: 0.0,
                },
            };

            const comparison = {
                hasBaseline: true,
                changes: {
                    conversionRateChangePct: -100,
                },
            };

            const periodContext = {
                reportType: "board",
                periodType: "weekly",
                periodLabel: "This Week",
                startDate: "2026-09-07",
                endDate: "2026-09-13",
                previousStartDate: "2026-08-31",
                previousEndDate: "2026-09-06",
            };

            const evidence = buildEvidence(metrics, null, comparison, periodContext);

            expect(evidence.context.reportType).toBe("board");
            expect(evidence.context.periodType).toBe("weekly");
            expect(evidence.context.currentPeriod.startDate).toBe("2026-09-07");
            expect(evidence.context.previousPeriod).toBeDefined();
            expect(evidence.facts.acquisition.uniqueVisitors.value).toBe(333);
            expect(evidence.observations.length).toBeGreaterThan(0);
            expect(evidence.rawMetrics).toBe(metrics);
            expect(evidence.rawComparison).toBe(comparison);
        });

        it("handles no previous period gracefully", () => {
            const metrics = {
                collectedAt: "2026-09-13T12:00:00Z",
                acquisition: {
                    uniqueVisitors: 100,
                },
            };

            const comparison = {
                hasBaseline: false,
            };

            const periodContext = {
                reportType: "marketing",
                periodType: "latest",
                periodLabel: "Today",
                startDate: "2026-09-13",
                endDate: "2026-09-13",
            };

            const evidence = buildEvidence(metrics, null, comparison, periodContext);

            expect(evidence.context.previousPeriod).toBeNull();
            expect(evidence.observations[0].type).toBe("NO_BASELINE");
        });
    });
});
