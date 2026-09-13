jest.mock("../src/insights/collector", () => ({
    collectAll: jest.fn(),
}));

jest.mock("../src/storage/s3Snapshot.service", () => ({
    getSnapshot: jest.fn(),
    putSnapshot: jest.fn(),
}));

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
}));

const { getOrBuildSnapshot } = require("../src/insights/reportMemory");
const { collectAll } = require("../src/insights/collector");
const s3Snapshot = require("../src/storage/s3Snapshot.service");

describe("Report Memory - Historical Snapshots", () => {
    const mockCurrentData = {
        collectedAt: "2026-09-13T12:00:00Z",
        windowDays: 7,
        offsetDays: 0,
        acquisition: { uniqueVisitors: 100 },
    };

    const mockPreviousData = {
        collectedAt: "2026-09-06T12:00:00Z",
        windowDays: 7,
        offsetDays: 0,
        acquisition: { uniqueVisitors: 80 },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Mock Date constructor and toISOString for consistent testing
        const mockDate = new Date("2026-09-13T12:00:00.000Z");
        jest.spyOn(global, "Date").mockImplementation(() => mockDate);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("uses cached current snapshot when available", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockCurrentData); // Current
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockPreviousData); // Previous

        const result = await getOrBuildSnapshot("test-group", "weekly");

        expect(result.current).toEqual(mockCurrentData);
        expect(collectAll).not.toHaveBeenCalled(); // Should not query PostHog
    });

    it("queries PostHog when current snapshot missing", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(null); // Current not cached
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockPreviousData); // Previous exists
        collectAll.mockResolvedValueOnce(mockCurrentData);

        const result = await getOrBuildSnapshot("test-group", "weekly");

        expect(collectAll).toHaveBeenCalledWith(7, 0); // days=7, offset=0
        expect(result.current).toEqual(mockCurrentData);
    });

    it("stores newly collected current snapshot to S3", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(null); // Not cached
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockPreviousData);
        collectAll.mockResolvedValueOnce(mockCurrentData);
        s3Snapshot.putSnapshot.mockResolvedValueOnce(undefined);

        await getOrBuildSnapshot("test-group", "weekly");

        expect(s3Snapshot.putSnapshot).toHaveBeenCalledWith({
            groupName: "test-group",
            reportType: "weekly",
            dateKey: "2026-09-13",
            payload: mockCurrentData,
        });
    });

    it("uses historical snapshot for previous period when available", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockCurrentData); // Current
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockPreviousData); // Previous from S3

        const result = await getOrBuildSnapshot("test-group", "weekly");

        expect(result.previous).toEqual(mockPreviousData);
        // Should NOT query PostHog for previous period
        expect(collectAll).not.toHaveBeenCalledWith(7, 7);
    });

    it("falls back to PostHog query when historical snapshot missing", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockCurrentData); // Current exists
        s3Snapshot.getSnapshot.mockResolvedValueOnce(null); // Previous not in S3
        collectAll.mockResolvedValueOnce(mockPreviousData); // Fallback query

        const result = await getOrBuildSnapshot("test-group", "weekly");

        expect(collectAll).toHaveBeenCalledWith(7, 7); // Fallback: days=7, offset=7
        expect(result.previous).toEqual(mockPreviousData);
    });

    it("calculates correct previous date key for weekly", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockCurrentData);
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockPreviousData);

        await getOrBuildSnapshot("test-group", "weekly");

        // Second call should be for previous period (7 days ago)
        expect(s3Snapshot.getSnapshot).toHaveBeenNthCalledWith(2, {
            groupName: "test-group",
            reportType: "weekly",
            dateKey: "2026-09-06", // 7 days before 2026-09-13
        });
    });

    it("calculates correct previous date key for monthly", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockCurrentData);
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockPreviousData);

        await getOrBuildSnapshot("test-group", "monthly");

        // Second call should be for previous period (30 days ago)
        expect(s3Snapshot.getSnapshot).toHaveBeenNthCalledWith(2, {
            groupName: "test-group",
            reportType: "monthly",
            dateKey: "2026-08-14", // 30 days before 2026-09-13
        });
    });

    it("calculates correct previous date key for quarterly", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockCurrentData);
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockPreviousData);

        await getOrBuildSnapshot("test-group", "quarterly");

        // Second call should be for previous period (90 days ago)
        expect(s3Snapshot.getSnapshot).toHaveBeenNthCalledWith(2, {
            groupName: "test-group",
            reportType: "quarterly",
            dateKey: "2026-06-15", // 90 days before 2026-09-13
        });
    });

    it("handles missing previous period gracefully", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockCurrentData);
        s3Snapshot.getSnapshot.mockResolvedValueOnce(null);
        collectAll.mockRejectedValueOnce(new Error("PostHog unavailable"));

        const result = await getOrBuildSnapshot("test-group", "weekly");

        expect(result.current).toEqual(mockCurrentData);
        expect(result.previous).toBeNull();
        expect(result.comparison.hasBaseline).toBe(false);
    });

    it("continues if snapshot storage fails", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(null);
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockPreviousData);
        collectAll.mockResolvedValueOnce(mockCurrentData);
        s3Snapshot.putSnapshot.mockRejectedValueOnce(new Error("S3 error"));

        const result = await getOrBuildSnapshot("test-group", "weekly");

        // Should still return the data even though storage failed
        expect(result.current).toEqual(mockCurrentData);
        expect(result.previous).toEqual(mockPreviousData);
    });

    it("produces comparison with both snapshots", async () => {
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockCurrentData);
        s3Snapshot.getSnapshot.mockResolvedValueOnce(mockPreviousData);

        const result = await getOrBuildSnapshot("test-group", "weekly");

        expect(result.comparison).toBeDefined();
        expect(result.comparison.hasBaseline).toBe(true);
        expect(result.comparison.changes).toBeDefined();
        // 100 vs 80 = 25% increase
        expect(result.comparison.changes.uniqueVisitorsChangePct).toBe(25);
    });
});
