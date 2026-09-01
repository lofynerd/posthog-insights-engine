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
jest.mock("../src/ai/analysis.service", () => ({
    generateReport: (...args) => mockGenerateReport(...args),
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

const { generateGroupReport, SOCIAL_REPORT_TYPES } = require("../src/insights/reportGenerator");

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
