jest.mock("axios", () => ({
    create: jest.fn(),
}));

jest.mock("../src/utils/logger", () => ({
    error: jest.fn(),
}));

const axios = require("axios");
const logger = require("../src/utils/logger");
const { PostHogService } = require("../src/services/posthog.service");

describe("PostHogService", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("posts HogQL queries to the configured project", async () => {
        const post = jest.fn().mockResolvedValue({
            data: { results: [[7]] },
        });

        axios.create.mockReturnValue({ post });

        const service = new PostHogService({
            apiKey: "test-api-key",
            projectId: "123",
            host: "https://posthog.example",
        });

        await expect(service.runHogQL("SELECT 1")).resolves.toEqual({
            results: [[7]],
        });

        expect(axios.create).toHaveBeenCalledWith({
            baseURL: "https://posthog.example/api/projects/123",
            headers: {
                Authorization: "Bearer test-api-key",
                "Content-Type": "application/json",
            },
            timeout: 25000,
            maxContentLength: 5 * 1024 * 1024,
            maxBodyLength: 5 * 1024 * 1024,
            maxRedirects: 0,
        });
        expect(post).toHaveBeenCalledWith("/query", {
            query: {
                kind: "HogQLQuery",
                query: "SELECT 1",
            },
        });
    });

    it("logs and wraps PostHog errors", async () => {
        const post = jest.fn().mockRejectedValue({
            response: {
                data: {
                    detail: "bad query",
                },
            },
        });

        axios.create.mockReturnValue({ post });

        const service = new PostHogService({
            apiKey: "test-api-key",
            projectId: "123",
            host: "https://posthog.example",
        });

        await expect(service.runHogQL("BROKEN")).rejects.toThrow(
            "PostHog query failed"
        );
        expect(logger.error).toHaveBeenCalledWith("PostHog query failed", {
            detail: "bad query",
        });
    });
});
