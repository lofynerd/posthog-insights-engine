jest.mock("../src/services/posthog.service", () => ({
    runHogQL: jest.fn(),
}));

const posthog = require("../src/services/posthog.service");
const conversion = require("../src/metrics/conversion");

describe("Conversion Metrics", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("calculates user-based conversion rate correctly", async () => {
        // Mock: 100 unique visitors, 3 unique purchasers
        posthog.runHogQL.mockImplementation((query) => {
            if (query.includes("uniq(person_id)")) {
                return Promise.resolve({
                    results: [[100, 50, 20, 10, 3, 500, 200, 25, 12, 3, 2]],
                    // [uniqueVisitors, uniqueProductViewers, uniqueCartUsers, uniqueCheckoutUsers, uniquePurchasers,
                    //  pageviews, productViews, addToCart, checkoutInitiated, purchases, cartRemoved]
                });
            }
            return Promise.resolve({ results: [] });
        });

        const result = await conversion.collect(30, 0);

        // User-based conversion rate: 3 purchasers / 100 visitors = 0.03 (3%)
        expect(result.conversionRate).toBe(0.03);
        expect(result.uniqueVisitors).toBe(100);
        expect(result.uniquePurchasers).toBe(3);
        
        // Event counts preserved
        expect(result.pageviews).toBe(500);
        expect(result.purchases).toBe(3);
    });

    it("handles zero visitors safely", async () => {
        posthog.runHogQL.mockImplementation(() =>
            Promise.resolve({
                results: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
            })
        );

        const result = await conversion.collect(30, 0);

        expect(result.conversionRate).toBeNull();
        expect(result.uniqueVisitors).toBe(0);
        expect(result.uniquePurchasers).toBe(0);
    });

    it("handles zero purchasers with visitors present", async () => {
        posthog.runHogQL.mockImplementation(() =>
            Promise.resolve({
                results: [[50, 20, 5, 2, 0, 200, 80, 7, 3, 0, 1]],
            })
        );

        const result = await conversion.collect(30, 0);

        expect(result.conversionRate).toBe(0); // 0 / 50 = 0
        expect(result.uniqueVisitors).toBe(50);
        expect(result.uniquePurchasers).toBe(0);
    });

    it("handles repeat visitors correctly (user counted once)", async () => {
        // One user with 10 pageviews should count as 1 unique visitor
        posthog.runHogQL.mockImplementation(() =>
            Promise.resolve({
                results: [[1, 1, 1, 1, 1, 10, 5, 2, 2, 2, 0]],
                // 1 unique visitor, 10 pageviews -> user visited 10 times
            })
        );

        const result = await conversion.collect(30, 0);

        expect(result.conversionRate).toBe(1.0); // 1 purchaser / 1 visitor = 100%
        expect(result.uniqueVisitors).toBe(1);
        expect(result.pageviews).toBe(10);
    });

    it("handles repeat purchasers correctly (user counted once)", async () => {
        // One user making 3 purchases should count as 1 unique purchaser
        posthog.runHogQL.mockImplementation(() =>
            Promise.resolve({
                results: [[5, 4, 3, 2, 1, 20, 15, 4, 3, 3, 0]],
                // 1 unique purchaser, 3 purchase events -> user purchased 3 times
            })
        );

        const result = await conversion.collect(30, 0);

        expect(result.conversionRate).toBe(0.2); // 1 purchaser / 5 visitors = 20%
        expect(result.uniquePurchasers).toBe(1);
        expect(result.purchases).toBe(3); // Event count preserved
    });

    it("calculates funnel stage rates correctly", async () => {
        posthog.runHogQL.mockImplementation(() =>
            Promise.resolve({
                results: [[100, 50, 20, 10, 5, 500, 200, 25, 12, 5, 2]],
            })
        );

        const result = await conversion.collect(30, 0);

        // Product view to cart: 20 / 50 = 0.4 (40%)
        expect(result.productViewToCartRate).toBe(0.4);
        
        // Cart to checkout: 10 / 20 = 0.5 (50%)
        expect(result.cartToCheckoutRate).toBe(0.5);
        
        // Checkout to purchase: 5 / 10 = 0.5 (50%)
        expect(result.checkoutToPurchaseRate).toBe(0.5);
    });

    it("handles missing data gracefully", async () => {
        posthog.runHogQL.mockImplementation(() =>
            Promise.resolve({ results: [] })
        );

        const result = await conversion.collect(30, 0);

        expect(result.conversionRate).toBeNull();
        expect(result.uniqueVisitors).toBe(0);
        expect(result.uniquePurchasers).toBe(0);
    });

    it("preserves revenue and order metrics", async () => {
        posthog.runHogQL.mockImplementation((query) => {
            if (query.includes("uniq(person_id)")) {
                return Promise.resolve({
                    results: [[100, 50, 20, 10, 5, 500, 200, 25, 12, 5, 2]],
                });
            }
            if (query.includes("total_revenue")) {
                return Promise.resolve({
                    results: [[1500.50, 5, 300.10]],
                });
            }
            return Promise.resolve({ results: [] });
        });

        const result = await conversion.collect(30, 0);

        expect(result.revenue).toBe(1500.50);
        expect(result.orderCount).toBe(5);
        expect(result.avgOrderValue).toBe(300.10);
    });

    it("conversion rate is bounded between 0 and 1", async () => {
        posthog.runHogQL.mockImplementation(() =>
            Promise.resolve({
                results: [[100, 50, 20, 10, 100, 500, 200, 25, 12, 100, 0]],
                // Edge case: all visitors purchased
            })
        );

        const result = await conversion.collect(30, 0);

        expect(result.conversionRate).toBe(1.0);
        expect(result.conversionRate).toBeGreaterThanOrEqual(0);
        expect(result.conversionRate).toBeLessThanOrEqual(1);
    });
});
