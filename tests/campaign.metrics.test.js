const mockRunHogQL = jest.fn();

jest.mock("../src/services/posthog.service", () => ({
    runHogQL: (...args) => mockRunHogQL(...args),
}));

const { collect, computeRoiPercent } = require("../src/metrics/campaign");

describe("computeRoiPercent", () => {
    it("computes a positive ROI", () => {
        // revenue 500, cost 200 -> (500-200)/200*100 = 150%
        expect(computeRoiPercent(500, 200)).toBe(150);
    });

    it("computes a negative ROI when the campaign lost money", () => {
        // revenue 50, cost 200 -> (50-200)/200*100 = -75%
        expect(computeRoiPercent(50, 200)).toBe(-75);
    });

    it("returns null (not Infinity/0) when cost is 0", () => {
        expect(computeRoiPercent(500, 0)).toBeNull();
    });

    it("returns null when cost is missing (null/undefined)", () => {
        expect(computeRoiPercent(500, null)).toBeNull();
        expect(computeRoiPercent(500, undefined)).toBeNull();
    });

    it("returns null when cost is negative (invalid input)", () => {
        expect(computeRoiPercent(500, -50)).toBeNull();
    });

    it("returns null when cost is not a finite number", () => {
        expect(computeRoiPercent(500, NaN)).toBeNull();
        expect(computeRoiPercent(500, Infinity)).toBeNull();
        expect(computeRoiPercent(500, "200")).toBeNull();
    });

    it("computes exactly 0% ROI when revenue equals cost", () => {
        expect(computeRoiPercent(200, 200)).toBe(0);
    });
});

describe("campaign metrics collect", () => {
    const influencer = { name: "Jane Doe", platform: "instagram", slug: "jane-doe", code: "JANE10", agreedFee: 200 };

    afterEach(() => jest.clearAllMocks());

    it("returns the full nested Campaign -> Influencer -> Code -> Cost -> Orders -> Units -> Revenue -> Conversion -> ROI shape", async () => {
        mockRunHogQL
            .mockResolvedValueOnce({ results: [[50, 60]] }) // reach, pageviews
            .mockResolvedValueOnce({ results: [[3, 300, 100, 5]] }); // orderCount, revenue, avgOrderValue, unitsSold

        const result = await collect(influencer, 30);

        expect(result.campaign).toEqual({ slug: "jane-doe", periodDays: 30 });
        expect(result.influencer).toEqual({ name: "Jane Doe", platform: "instagram" });
        expect(result.code).toBe("JANE10");
        expect(result.cost).toBe(200);
        expect(result.orders).toBe(3);
        expect(result.unitsSold).toBe(5);
        expect(result.revenue).toBe(300);
        expect(result.conversionRate).toBe(0.06); // 3/50
        // (300-200)/200*100 = 50%
        expect(result.roiPercent).toBe(50);
        expect(result.profit).toBe(100);
    });

    it("collects all-time when days is null", async () => {
        mockRunHogQL
            .mockResolvedValueOnce({ results: [[50, 60]] })
            .mockResolvedValueOnce({ results: [[3, 300, 100, 5]] });

        const result = await collect(influencer, null);

        expect(result.campaign.periodDays).toBeNull();
    });

    it("returns null ROI (N/A) when cost is 0", async () => {
        mockRunHogQL
            .mockResolvedValueOnce({ results: [[50, 60]] })
            .mockResolvedValueOnce({ results: [[3, 300, 100, 5]] });

        const result = await collect({ ...influencer, agreedFee: 0 }, 30);

        expect(result.cost).toBeNull();
        expect(result.roiPercent).toBeNull();
        expect(result.profit).toBeNull();
    });

    it("returns null ROI (N/A) when cost is missing entirely", async () => {
        mockRunHogQL
            .mockResolvedValueOnce({ results: [[50, 60]] })
            .mockResolvedValueOnce({ results: [[3, 300, 100, 5]] });

        const result = await collect({ ...influencer, agreedFee: null }, 30);

        expect(result.cost).toBeNull();
        expect(result.roiPercent).toBeNull();
        expect(result.profit).toBeNull();
    });

    it("returns null ROI (N/A) when cost is negative (invalid data)", async () => {
        mockRunHogQL
            .mockResolvedValueOnce({ results: [[50, 60]] })
            .mockResolvedValueOnce({ results: [[3, 300, 100, 5]] });

        const result = await collect({ ...influencer, agreedFee: -50 }, 30);

        expect(result.cost).toBeNull();
        expect(result.roiPercent).toBeNull();
    });

    it("computes negative ROI/profit when the campaign lost money", async () => {
        mockRunHogQL
            .mockResolvedValueOnce({ results: [[50, 60]] })
            .mockResolvedValueOnce({ results: [[1, 50, 50, 1]] });

        const result = await collect(influencer, 30);

        expect(result.profit).toBe(-150); // 50 - 200
        expect(result.roiPercent).toBe(-75); // (50-200)/200*100
    });

    it("defaults units sold, revenue, and orders to 0/null when there are no matching purchases", async () => {
        mockRunHogQL
            .mockResolvedValueOnce({ results: [[10, 12]] })
            .mockResolvedValueOnce({ results: [] });

        const result = await collect(influencer, 30);

        expect(result.orders).toBe(0);
        expect(result.unitsSold).toBe(0);
        expect(result.revenue).toBe(0);
        expect(result.profit).toBe(-200); // 0 - 200
    });

    it("returns null conversion rate when reach is 0 (avoids divide-by-zero)", async () => {
        mockRunHogQL
            .mockResolvedValueOnce({ results: [[0, 0]] })
            .mockResolvedValueOnce({ results: [[0, null, null, null]] });

        const result = await collect(influencer, 30);

        expect(result.conversionRate).toBeNull();
    });

    it("keeps backwards-compatible flat aliases for existing callers", async () => {
        mockRunHogQL
            .mockResolvedValueOnce({ results: [[50, 60]] })
            .mockResolvedValueOnce({ results: [[3, 300, 100, 5]] });

        const result = await collect(influencer, 30);

        expect(result.agreedFee).toBe(result.cost);
        expect(result.orderCount).toBe(result.orders);
    });

    it("uses windowed (not all-time) queries when days is a number", async () => {
        mockRunHogQL.mockResolvedValue({ results: [[1, 1]] });

        await collect(influencer, 7);

        expect(mockRunHogQL).toHaveBeenCalledTimes(2);
    });
});
