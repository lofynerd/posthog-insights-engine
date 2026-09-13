const {
    validateRequiredSections,
    validateNoBannedPhrases,
    validateNoBoxDrawing,
    validateScoresPresent,
    validateReport,
} = require("../src/ai/outputValidator");

describe("Output Validator", () => {
    describe("validateRequiredSections", () => {
        it("passes with all required sections", () => {
            const reportText = `
📊 Board Report
2026-09-13 · This Week

❤️ Health Score: 65  🧠 Confidence: 45
Rating: 🟡 Stable

📈 KPI Snapshot
Test data

🔥 Biggest Win
Test

⚠ Biggest Risk
Test

🧠 AI Insights
Test

🎯 Top Priorities
Test

📅 Immediate Action
Test

🤖 Executive Verdict
Test
            `;

            const result = validateRequiredSections(reportText);
            expect(result.valid).toBe(true);
            expect(result.missingSections).toHaveLength(0);
        });

        it("fails with missing sections", () => {
            const reportText = "Health Score: 65\nConfidence: 45";

            const result = validateRequiredSections(reportText);
            expect(result.valid).toBe(false);
            expect(result.missingSections.length).toBeGreaterThan(0);
        });
    });

    describe("validateNoBannedPhrases", () => {
        it("passes without banned phrases", () => {
            const reportText = "Bounce rate increased 15% versus previous period.";

            const result = validateNoBannedPhrases(reportText);
            expect(result.valid).toBe(true);
            expect(result.foundBanned).toHaveLength(0);
        });

        it("fails with banned phrases", () => {
            const reportText = "It is important to note that the data suggests growth. Overall, things look good.";

            const result = validateNoBannedPhrases(reportText);
            expect(result.valid).toBe(false);
            expect(result.foundBanned.length).toBeGreaterThan(0);
        });
    });

    describe("validateNoBoxDrawing", () => {
        it("passes without box drawing characters", () => {
            const reportText = "Normal text with bullets: • Item 1 • Item 2";

            const result = validateNoBoxDrawing(reportText);
            expect(result.valid).toBe(true);
        });

        it("fails with box drawing characters", () => {
            const reportText = "Text with box: ┌─────┐\n│ Box │\n└─────┘";

            const result = validateNoBoxDrawing(reportText);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain("box-drawing");
        });
    });

    describe("validateScoresPresent", () => {
        it("passes with correct scores", () => {
            const reportText = "❤️ Health Score: 65  🧠 Confidence: 45";
            const healthScore = { score: 65, notes: [] };
            const confidenceScore = 45;

            const result = validateScoresPresent(reportText, healthScore, confidenceScore);
            expect(result.valid).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it("fails when health score is missing", () => {
            const reportText = "Confidence: 45";
            const healthScore = { score: 65 };
            const confidenceScore = 45;

            const result = validateScoresPresent(reportText, healthScore, confidenceScore);
            expect(result.valid).toBe(false);
            expect(result.issues.some((i) => i.includes("Health Score"))).toBe(true);
        });

        it("fails when confidence score is missing", () => {
            const reportText = "Health Score: 65";
            const healthScore = { score: 65 };
            const confidenceScore = 45;

            const result = validateScoresPresent(reportText, healthScore, confidenceScore);
            expect(result.valid).toBe(false);
            expect(result.issues.some((i) => i.includes("Confidence"))).toBe(true);
        });
    });

    describe("validateReport", () => {
        const validReport = `
📊 Board Report
2026-09-13 · This Week

❤️ Health Score: 65  🧠 Confidence: 45
Rating: 🟡 Stable

📈 KPI Snapshot
• Visitors: 333

🔥 Biggest Win
Traffic increased

⚠ Biggest Risk
Low conversion

🧠 AI Insights
• 📊 FACT: Conversion rate 0%
  OBSERVATION: No purchases completed
  POSSIBLE EXPLANATION: May indicate checkout issues
  RECOMMENDATION: Investigate payment processing

🎯 Top Priorities
🔥 Fix checkout flow

📅 Immediate Action
Review payment logs

🤖 Executive Verdict
System stable, needs checkout fix.
        `;

        it("passes comprehensive validation", () => {
            const context = {
                healthScore: { score: 65 },
                confidenceScore: 45,
            };

            const result = validateReport(validReport, context);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("collects multiple errors", () => {
            const invalidReport = "Just some text with banned phrase: it is important to note";

            const result = validateReport(invalidReport);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it("collects warnings without failing validation", () => {
            const reportWithWarnings = validReport + "\nOverall, things look good.";
            const context = {
                healthScore: { score: 65 },
                confidenceScore: 45,
            };

            const result = validateReport(reportWithWarnings, context);
            // Valid despite warnings
            expect(result.valid).toBe(true);
            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });
});
