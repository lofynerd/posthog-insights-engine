const mockGetOrBuildSnapshot = jest.fn();
jest.mock("../src/insights/reportMemory", () => ({
    getOrBuildSnapshot: (...args) => mockGetOrBuildSnapshot(...args),
    PERIOD_DEFINITIONS: {
        latest: { days: 1, label: "Today" },
        weekly: { days: 7, label: "This week" },
        monthly: { days: 30, label: "This month" },
        quarterly: { days: 90, label: "This quarter" },
    },
}));

const mockGenerateReport = jest.fn();
const mockGenerateMetricCaption = jest.fn();
jest.mock("../src/ai/analysis.service", () => ({
    generateReport: (...args) => mockGenerateReport(...args),
    generateMetricCaption: (...args) => mockGenerateMetricCaption(...args),
}));

const mockExportInsightPng = jest.fn();
jest.mock("../src/services/posthogExport.service", () => ({
    getInstance: jest.fn(() => ({ exportInsightPng: (...args) => mockExportInsightPng(...args) })),
}));

const mockCollectInstagram = jest.fn();
jest.mock("../src/metrics/social", () => ({
    collectInstagram: (...args) => mockCollectInstagram(...args),
}));

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const { generateGroupReport, generateCompactSummary, SOCIAL_REPORT_TYPES } = require("../src/insights/reportGenerator");

describe("generateGroupReport", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetOrBuildSnapshot.mockResolvedValue({
            current: { acquisition: { pageviews: 100, uniqueVisitors: 20 }, engagement: {}, conversion: {}, geography: {} },
            comparison: { hasBaseline: false, changes: {} },
        });
        mockGenerateReport.mockResolvedValue("Report text");
    });

    it("exposes marketing and pr as the audiences that get Instagram data", () => {
        expect(SOCIAL_REPORT_TYPES).toEqual(["marketing", "pr"]);
    });

    it("does not fetch Instagram data for a board report", async () => {
        await generateGroupReport("Board Group", "board", "weekly");

        expect(mockCollectInstagram).not.toHaveBeenCalled();
        const [, context] = mockGenerateReport.mock.calls[0];
        expect(context.metrics.social).toBeUndefined();
    });

    it("does not fetch Instagram data for a development report", async () => {
        await generateGroupReport("Dev Group", "development", "weekly");

        expect(mockCollectInstagram).not.toHaveBeenCalled();
    });

    it("fetches and includes Instagram data for a marketing report", async () => {
        mockCollectInstagram.mockResolvedValue({ reach: 500, accountsEngaged: 40, followerCount: 1000, topPost: null });

        await generateGroupReport("Marketing Group", "marketing", "weekly");

        expect(mockCollectInstagram).toHaveBeenCalledWith(7, 5);
        const [, context] = mockGenerateReport.mock.calls[0];
        expect(context.metrics.social).toEqual({ reach: 500, accountsEngaged: 40, followerCount: 1000, topPost: null });
    });

    it("fetches and includes Instagram data for a pr report", async () => {
        mockCollectInstagram.mockResolvedValue({ reach: 200, accountsEngaged: 10, followerCount: 900, topPost: null });

        await generateGroupReport("PR Group", "pr", "monthly");

        expect(mockCollectInstagram).toHaveBeenCalledWith(30, 5);
        const [, context] = mockGenerateReport.mock.calls[0];
        expect(context.metrics.social).toBeDefined();
    });

    it("resolves legacy report type aliases when deciding whether to include Instagram data", async () => {
        mockCollectInstagram.mockResolvedValue({ reach: 1 });

        // "founder" is a legacy alias for "board" -- must NOT trigger Instagram.
        await generateGroupReport("Legacy Group", "founder", "weekly");
        expect(mockCollectInstagram).not.toHaveBeenCalled();
    });

    it("omits the social section (without failing the report) when Instagram collection throws", async () => {
        mockCollectInstagram.mockRejectedValue(new Error("Instagram account insights request failed"));

        const result = await generateGroupReport("Marketing Group", "marketing", "weekly");

        expect(result.reportText).toBe("Report text");
        const [, context] = mockGenerateReport.mock.calls[0];
        expect(context.metrics.social).toBeUndefined();
    });

    it("passes the metrics (with social folded in) back as `current` in the return value", async () => {
        mockCollectInstagram.mockResolvedValue({ reach: 42 });

        const result = await generateGroupReport("Marketing Group", "marketing", "weekly");

        expect(result.current.social).toEqual({ reach: 42 });
    });

    it("does not mutate the snapshot returned by getOrBuildSnapshot", async () => {
        mockCollectInstagram.mockResolvedValue({ reach: 42 });
        const snapshotCurrent = { acquisition: {}, engagement: {}, conversion: {}, geography: {} };
        mockGetOrBuildSnapshot.mockResolvedValue({ current: snapshotCurrent, comparison: { hasBaseline: false, changes: {} } });

        await generateGroupReport("Marketing Group", "marketing", "weekly");

        expect(snapshotCurrent.social).toBeUndefined();
    });
});

describe("generateCompactSummary", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetOrBuildSnapshot.mockResolvedValue({
            current: { acquisition: { uniqueVisitors: 120, pageviews: 300 } },
            previous: { acquisition: { uniqueVisitors: 100, pageviews: 290 } },
            comparison: { hasBaseline: true, changes: {} },
        });
        mockExportInsightPng.mockResolvedValue(Buffer.from("fake-png"));
        mockGenerateMetricCaption.mockResolvedValue("Caption text.");
    });

    it("exports the chart for the selected metric and returns it as imageBuffer", async () => {
        const result = await generateCompactSummary("Marketing Group", "marketing", "weekly");

        expect(mockExportInsightPng).toHaveBeenCalled();
        expect(Buffer.isBuffer(result.imageBuffer)).toBe(true);
        expect(result.imageBuffer.toString()).toBe("fake-png");
    });

    it("generates a caption via the narrow AI method, not the full report generator", async () => {
        await generateCompactSummary("Marketing Group", "marketing", "weekly");

        expect(mockGenerateMetricCaption).toHaveBeenCalled();
        expect(mockGenerateReport).not.toHaveBeenCalled();
    });

    it("passes the selected metric's changePct and label into the caption call", async () => {
        await generateCompactSummary("Marketing Group", "marketing", "weekly");

        const [captionArgs] = mockGenerateMetricCaption.mock.calls[0];
        expect(captionArgs.metricLabel).toBe("Website Unique Users");
        expect(captionArgs.changePct).toBe(20);
        expect(captionArgs.isFallback).toBe(false);
    });

    it("returns caption, healthScore, confidenceScore, and selectedMetric", async () => {
        const result = await generateCompactSummary("Marketing Group", "marketing", "weekly");

        expect(result.caption).toContain("Caption text.");
        expect(result.healthScore).toBeDefined();
        expect(typeof result.confidenceScore).toBe("number");
        expect(result.selectedMetric.metricKey).toBe("uniqueVisitors");
    });

    it("falls back to imageBuffer null (text-only) when chart export fails, without throwing", async () => {
        mockExportInsightPng.mockRejectedValue(new Error("PostHog export failed"));

        const result = await generateCompactSummary("Marketing Group", "marketing", "weekly");

        expect(result.imageBuffer).toBeNull();
        expect(result.caption).toContain("Caption text."); // caption generation still proceeds
    });

    it("falls back to a minimal caption (without throwing) when AI caption generation fails", async () => {
        mockGenerateMetricCaption.mockRejectedValue(new Error("AI request failed"));

        const result = await generateCompactSummary("Marketing Group", "marketing", "weekly");

        expect(result.caption).toContain("Website Unique Users");
        expect(result.caption).toContain("20%");
    });

    it("uses a steady-baseline fallback caption (no throw) when both export and AI fail on a fallback pick", async () => {
        mockGetOrBuildSnapshot.mockResolvedValue({
            current: {},
            previous: {},
            comparison: { hasBaseline: true, changes: {} },
        });
        mockExportInsightPng.mockRejectedValue(new Error("export failed"));
        mockGenerateMetricCaption.mockRejectedValue(new Error("AI failed"));

        const result = await generateCompactSummary("Marketing Group", "marketing", "weekly");

        expect(result.selectedMetric.isFallback).toBe(true);
        expect(result.imageBuffer).toBeNull();
        expect(result.caption).toContain("steady");
    });

    it("includes Instagram data for marketing/pr before selecting the metric", async () => {
        mockCollectInstagram.mockResolvedValue({ reach: 500 });

        await generateCompactSummary("Marketing Group", "marketing", "weekly");

        const [captionArgs] = mockGenerateMetricCaption.mock.calls[0];
        expect(captionArgs.metrics.social).toEqual({ reach: 500 });
    });

    it("does not fetch Instagram data for a board summary", async () => {
        await generateCompactSummary("Board Group", "board", "weekly");

        expect(mockCollectInstagram).not.toHaveBeenCalled();
    });

    it("prepends a deterministic Health/Confidence indicator line above the caption", async () => {
        const result = await generateCompactSummary("Marketing Group", "marketing", "weekly");

        const firstLine = result.caption.split("\n")[0];
        expect(firstLine).toMatch(/Health \d+\/100 · Confidence \d+\/100/);
        expect(firstLine).toMatch(/[🟢🟡🟠🔴]/);
    });

    it("keeps the indicator line even when AI caption generation fails", async () => {
        mockGenerateMetricCaption.mockRejectedValue(new Error("AI request failed"));

        const result = await generateCompactSummary("Marketing Group", "marketing", "weekly");

        expect(result.caption.split("\n")[0]).toMatch(/Health \d+\/100/);
    });
});
