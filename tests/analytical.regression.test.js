/**
 * Analytical Regression Tests
 * 
 * Tests for specific analytical quality problems discovered during manual
 * Telegram testing. These tests verify that the system prevents known
 * failure modes.
 */

const { buildEvidence } = require("../src/insights/evidenceBuilder");
const { AnalysisService } = require("../src/ai/analysis.service");

describe("Analytical Quality Regression Tests", () => {
    describe("CASE A: Zero Conversion with Checkout Activity", () => {
        it("creates observation for checkout without purchase", () => {
            const metrics = {
                collectedAt: "2026-09-13T12:00:00Z",
                conversion: {
                    uniqueVisitors: 333,
                    uniqueCheckoutUsers: 8,
                    uniquePurchasers: 0,
                    conversionRate: 0,
                },
            };

            const comparison = { hasBaseline: true, changes: {} };
            const periodContext = {
                reportType: "board",
                periodType: "weekly",
                periodLabel: "This Week",
                startDate: "2026-09-07",
                endDate: "2026-09-13",
            };

            const evidence = buildEvidence(metrics, null, comparison, periodContext);

            const checkoutObs = evidence.observations.find((o) => o.type === "CHECKOUT_WITHOUT_PURCHASE");
            expect(checkoutObs).toBeDefined();
            expect(checkoutObs.text).toContain("8 users initiated checkout");
            expect(checkoutObs.text).toContain("0 users completed an order");
            expect(checkoutObs.evidenceStrength).toBe("SUPPORTED");
            
            // The system must NOT claim "the entire conversion funnel is broken"
            // That's an interpretation, not an observation
        });

        it("system prompt allows investigation recommendations for unclear causes", () => {
            const service = new AnalysisService({
                apiKey: "test-key",
                baseUrl: "https://test.api",
                model: "test-model",
            });

            const definition = {
                title: "Test Report",
                key: "board",
                focus: ["Revenue"],
                exclude: [],
            };

            const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

            // Verify the prompt recommends investigation when evidence is weak
            expect(systemPrompt).toContain("investigate");
            expect(systemPrompt).toContain("Verify");
        });
    });

    describe("CASE B: Direct Traffic Increase", () => {
        it("system prompt forbids claiming bots without evidence", () => {
            const service = new AnalysisService({
                apiKey: "test-key",
                baseUrl: "https://test.api",
                model: "test-model",
            });

            const definition = {
                title: "Test Report",
                key: "marketing",
                focus: ["Traffic"],
                exclude: [],
            };

            const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

            // The system must NOT claim "bots caused the increase" without evidence
            expect(systemPrompt).toContain("NEVER infer causation from correlation");
            expect(systemPrompt).toContain("Insufficient evidence to determine the cause");
        });
    });

    describe("CASE C: Unique Visitor Increase", () => {
        it("distinguishes unique visitors from new visitors", () => {
            const metrics = {
                collectedAt: "2026-09-13T12:00:00Z",
                acquisition: {
                    uniqueVisitors: 333,
                    returningVisitors: 150,
                },
            };

            const comparison = { hasBaseline: true, changes: { uniqueVisitorsChangePct: 20 } };
            const periodContext = {
                reportType: "marketing",
                periodType: "weekly",
                periodLabel: "This Week",
                startDate: "2026-09-07",
                endDate: "2026-09-13",
            };

            const evidence = buildEvidence(metrics, null, comparison, periodContext);

            const visitorObs = evidence.observations.find((o) => o.type === "VISITOR_COMPOSITION");
            expect(visitorObs).toBeDefined();
            
            // The observation should provide both returning and new visitor counts
            expect(visitorObs.facts.returningVisitors).toBe(150);
            expect(visitorObs.facts.newVisitors).toBe(183); // 333 - 150
        });

        it("system prompt clarifies unique vs new visitors", () => {
            const service = new AnalysisService({
                apiKey: "test-key",
                baseUrl: "https://test.api",
                model: "test-model",
            });

            const definition = {
                title: "Test Report",
                key: "marketing",
                focus: ["Traffic"],
                exclude: [],
            };

            const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

            // The system must NOT say "unique visitors increased" implies "new visitors increased"
            expect(systemPrompt).toContain("Unique visitors = distinct people observed this period");
            expect(systemPrompt).toContain("New visitors = people who appeared for the first time");
            expect(systemPrompt).toContain('Only use "new visitors" if evidence.observations explicitly provides that count');
        });
    });

    describe("CASE D: Mobile Traffic Presence", () => {
        it("system prompt requires evidence for mobile UX claims", () => {
            const service = new AnalysisService({
                apiKey: "test-key",
                baseUrl: "https://test.api",
                model: "test-model",
            });

            const definition = {
                title: "Test Report",
                key: "development",
                focus: ["Performance"],
                exclude: [],
            };

            const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

            // The system must NOT claim "mobile UX is poor" just because mobile traffic exists
            expect(systemPrompt).toContain('Do NOT say "mobile UX is poor" just because mobile traffic exists');
            expect(systemPrompt).toContain("Only recommend mobile UX work if evidence shows mobile-specific problems");
        });
    });

    describe("CASE E: Period Consistency", () => {
        it("includes period context in evidence", () => {
            const metrics = {
                collectedAt: "2026-09-13T12:00:00Z",
                acquisition: { uniqueVisitors: 100 },
            };

            const comparison = { hasBaseline: true, changes: {} };
            const periodContext = {
                reportType: "board",
                periodType: "quarterly",
                periodLabel: "This Quarter",
                startDate: "2026-07-01",
                endDate: "2026-09-13",
            };

            const evidence = buildEvidence(metrics, null, comparison, periodContext);

            expect(evidence.context.periodType).toBe("quarterly");
            expect(evidence.context.periodLabel).toBe("This Quarter");
            expect(evidence.context.currentPeriod.startDate).toBe("2026-07-01");
        });

        it("system prompt enforces period consistency", () => {
            const service = new AnalysisService({
                apiKey: "test-key",
                baseUrl: "https://test.api",
                model: "test-model",
            });

            const definition = {
                title: "Test Report",
                key: "board",
                focus: ["Revenue"],
                exclude: [],
            };

            const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

            // A quarterly report must not refer to "this week"
            expect(systemPrompt).toContain('NEVER say "this week" in a quarterly report');
            expect(systemPrompt).toContain("Use ONLY the period labels provided in the context");
        });
    });

    describe("CASE F: Percentage Formatting", () => {
        it("formats bounce rate as percentage not decimal", () => {
            const metrics = {
                collectedAt: "2026-09-13T12:00:00Z",
                engagement: {
                    bounceRate: 0.6476,
                },
            };

            const comparison = { hasBaseline: false };
            const periodContext = {
                reportType: "development",
                periodType: "weekly",
                periodLabel: "This Week",
                startDate: "2026-09-07",
                endDate: "2026-09-13",
            };

            const evidence = buildEvidence(metrics, null, comparison, periodContext);

            // Bounce rate should be formatted as "64.76%" not 0.6476
            expect(evidence.facts.engagement.bounceRate.formatted).toBe("64.76%");
            expect(evidence.facts.engagement.bounceRate.value).toBe(0.6476); // raw value preserved
        });

        it("system prompt instructs AI to use formatted values", () => {
            const service = new AnalysisService({
                apiKey: "test-key",
                baseUrl: "https://test.api",
                model: "test-model",
            });

            const definition = {
                title: "Test Report",
                key: "board",
                focus: ["Revenue"],
                exclude: [],
            };

            const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

            // The prompt should tell AI to use formatted values from evidence.facts
            expect(systemPrompt).toContain("Use the formatted values from evidence.facts");
            expect(systemPrompt).toContain('(e.g. "64.76%" not 0.6476)');
        });
    });

    describe("CASE G: PR Persona Relevance", () => {
        it("PR report type focuses on brand visibility metrics", () => {
            const service = new AnalysisService({
                apiKey: "test-key",
                baseUrl: "https://test.api",
                model: "test-model",
            });

            const definition = {
                title: "📢 PR Report",
                key: "pr",
                focus: ["Brand Visibility", "Audience Growth", "Media Reach"],
                exclude: ["AWS", "infrastructure"],
            };

            const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

            // PR report should focus on PR-relevant concerns
            expect(systemPrompt).toContain("Brand Visibility");
            expect(systemPrompt).toContain("Audience Growth");
            expect(systemPrompt).toContain("Media Reach");
        });
    });

    describe("CASE H: Insufficient Evidence Handling", () => {
        it("creates insufficient evidence observation when no baseline exists", () => {
            const metrics = {
                collectedAt: "2026-09-13T12:00:00Z",
                acquisition: { uniqueVisitors: 100 },
            };

            const comparison = { hasBaseline: false };
            const periodContext = {
                reportType: "board",
                periodType: "weekly",
                periodLabel: "This Week",
                startDate: "2026-09-07",
                endDate: "2026-09-13",
            };

            const evidence = buildEvidence(metrics, null, comparison, periodContext);

            const insufficientObs = evidence.observations.find((o) => o.type === "NO_BASELINE");
            expect(insufficientObs).toBeDefined();
            expect(insufficientObs.evidenceStrength).toBe("INSUFFICIENT");
        });

        it("system prompt allows saying insufficient evidence", () => {
            const service = new AnalysisService({
                apiKey: "test-key",
                baseUrl: "https://test.api",
                model: "test-model",
            });

            const definition = {
                title: "Test Report",
                key: "board",
                focus: ["Revenue"],
                exclude: [],
            };

            const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

            // The AI should be allowed to say "insufficient evidence"
            expect(systemPrompt).toContain("Insufficient evidence to determine the cause");
            expect(systemPrompt).toContain("say \"insufficient evidence\" if cause is unclear");
        });
    });
});
