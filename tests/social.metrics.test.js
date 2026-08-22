const mockGetAccountInsights = jest.fn();
const mockListRecentMedia = jest.fn();
const mockGetMediaInsights = jest.fn();

jest.mock("../src/services/instagram.service", () => ({
    getInstance: () => ({
        getAccountInsights: mockGetAccountInsights,
        listRecentMedia: mockListRecentMedia,
        getMediaInsights: mockGetMediaInsights,
    }),
}));

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const { collectInstagram } = require("../src/metrics/social");

describe("collectInstagram", () => {
    afterEach(() => jest.clearAllMocks());

    it("combines account insights with ranked post engagement", async () => {
        mockGetAccountInsights.mockResolvedValue({ reach: 1000, accounts_engaged: 50, follower_count: 500 });
        mockListRecentMedia.mockResolvedValue([
            { id: "1", caption: "Low engagement post", media_type: "IMAGE", timestamp: "2026-01-01" },
            { id: "2", caption: "High engagement post", media_type: "REELS", timestamp: "2026-01-02" },
        ]);
        mockGetMediaInsights.mockImplementation((id) =>
            id === "1"
                ? Promise.resolve({ likes: 5, comments: 1, total_interactions: 6 })
                : Promise.resolve({ likes: 100, comments: 20, total_interactions: 120 })
        );

        const result = await collectInstagram(30, 10);

        expect(result.reach).toBe(1000);
        expect(result.accountsEngaged).toBe(50);
        expect(result.followerCount).toBe(500);
        expect(result.postsAnalyzed).toBe(2);
        expect(result.topPost.id).toBe("2");
        expect(result.topPost.totalInteractions).toBe(120);
        expect(result.recentPosts[0].id).toBe("2");
    });

    it("handles a per-post insights failure gracefully without failing the whole report", async () => {
        mockGetAccountInsights.mockResolvedValue({ reach: 1000 });
        mockListRecentMedia.mockResolvedValue([{ id: "1", caption: "A post" }]);
        mockGetMediaInsights.mockRejectedValue(new Error("Not enough viewers"));

        const result = await collectInstagram();

        expect(result.postsAnalyzed).toBe(1);
        expect(result.topPost.totalInteractions).toBeNull();
    });

    it("returns null topPost when there are no posts", async () => {
        mockGetAccountInsights.mockResolvedValue({ reach: 0 });
        mockListRecentMedia.mockResolvedValue([]);

        const result = await collectInstagram();

        expect(result.topPost).toBeNull();
        expect(result.recentPosts).toEqual([]);
    });

    it("truncates long captions", async () => {
        mockGetAccountInsights.mockResolvedValue({});
        mockListRecentMedia.mockResolvedValue([{ id: "1", caption: "x".repeat(300) }]);
        mockGetMediaInsights.mockResolvedValue({ total_interactions: 10 });

        const result = await collectInstagram();

        expect(result.topPost.caption.length).toBe(100);
    });
});
