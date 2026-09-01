jest.mock("axios", () => ({
    create: jest.fn(),
    get: jest.fn(),
}));

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const axios = require("axios");
const { PostHogExportService } = require("../src/services/posthogExport.service");

describe("PostHogExportService", () => {
    afterEach(() => jest.clearAllMocks());

    function buildService({ post, get } = {}) {
        axios.create.mockReturnValue({ post: post || jest.fn(), get: get || jest.fn() });
        return new PostHogExportService({
            apiKey: "test-api-key",
            projectId: "123",
            host: "https://posthog.example",
        });
    }

    it("throws if constructed without apiKey/projectId", () => {
        expect(() => new PostHogExportService({})).toThrow(/apiKey and projectId/);
    });

    it("rejects a non-positive-integer insight ID before making a network call", async () => {
        const post = jest.fn();
        const service = buildService({ post });

        await expect(service.exportInsightPng(-1)).rejects.toThrow(/Invalid insight ID/);
        await expect(service.exportInsightPng("abc")).rejects.toThrow(/Invalid insight ID/);
        expect(post).not.toHaveBeenCalled();
    });

    it("returns the image bytes directly when PostHog responds 200 (no redirect)", async () => {
        const post = jest.fn().mockResolvedValue({
            data: { id: 999, has_content: true, exception: null },
        });
        // Observed in production: the content endpoint sometimes
        // returns the PNG bytes directly with a 200, not a redirect.
        const get = jest.fn().mockResolvedValue({
            status: 200,
            data: Buffer.from("fake-png-bytes-direct"),
        });
        const service = buildService({ post, get });

        const result = await service.exportInsightPng(12345);

        expect(get).toHaveBeenCalledWith(
            "/exports/999/content/",
            expect.objectContaining({ responseType: "arraybuffer" })
        );
        expect(axios.get).not.toHaveBeenCalled();
        expect(Buffer.isBuffer(result)).toBe(true);
        expect(result.toString()).toBe("fake-png-bytes-direct");
    });

    it("creates an export, follows a 302 redirect manually, then downloads the S3 content unauthenticated", async () => {
        const post = jest.fn().mockResolvedValue({
            data: { id: 999, has_content: true, exception: null },
        });
        // Also observed in production: the content endpoint 302s to a
        // signed S3 URL rather than returning bytes directly.
        const get = jest.fn().mockResolvedValue({
            status: 302,
            headers: { location: "https://s3.example.com/signed-url" },
        });
        const service = buildService({ post, get });

        // Module-level axios.get is used for the actual S3 fetch
        // (deliberately NOT going through this.client, so the
        // PostHog Authorization header is never sent to S3).
        axios.get.mockResolvedValue({ data: Buffer.from("fake-png-bytes") });

        const result = await service.exportInsightPng(12345);

        expect(post).toHaveBeenCalledWith("/exports/", { export_format: "image/png", insight: 12345 });
        expect(get).toHaveBeenCalledWith(
            "/exports/999/content/",
            expect.objectContaining({ validateStatus: expect.any(Function) })
        );
        expect(axios.get).toHaveBeenCalledWith(
            "https://s3.example.com/signed-url",
            expect.objectContaining({ responseType: "arraybuffer", maxRedirects: 0 })
        );
        // Confirm no Authorization header is sent on the S3 request.
        const s3CallOptions = axios.get.mock.calls[0][1];
        expect(s3CallOptions.headers).toBeUndefined();

        expect(Buffer.isBuffer(result)).toBe(true);
        expect(result.toString()).toBe("fake-png-bytes");
    });

    it("throws a clear error if a 302 redirect response has no Location header", async () => {
        const post = jest.fn().mockResolvedValue({ data: { id: 999, has_content: true, exception: null } });
        const get = jest.fn().mockResolvedValue({ status: 302, headers: {} });
        const service = buildService({ post, get });

        await expect(service.exportInsightPng(12345)).rejects.toThrow("PostHog export download failed");
    });

    it("throws a clear error when the export job fails server-side (exception field set)", async () => {
        const post = jest.fn().mockResolvedValue({
            data: { id: 999, has_content: false, exception: "Aggregation nesting error" },
        });
        const get = jest.fn();
        const service = buildService({ post, get });

        await expect(service.exportInsightPng(12345)).rejects.toThrow(/PostHog export failed/);
        expect(get).not.toHaveBeenCalled();
    });

    it("throws a clear error when export creation itself fails", async () => {
        const post = jest.fn().mockRejectedValue({ response: { data: { detail: "not found" } } });
        const service = buildService({ post });

        await expect(service.exportInsightPng(12345)).rejects.toThrow("PostHog export creation failed");
    });

    it("throws a clear error when content download fails", async () => {
        const post = jest.fn().mockResolvedValue({ data: { id: 999, has_content: true, exception: null } });
        const get = jest.fn().mockRejectedValue(new Error("network down"));
        const service = buildService({ post, get });

        await expect(service.exportInsightPng(12345)).rejects.toThrow("PostHog export download failed");
    });

    describe("getInstance", () => {
        it("returns the same instance on repeated calls", () => {
            const OLD_ENV = process.env;
            process.env = { ...OLD_ENV, POSTHOG_API_KEY: "key", POSTHOG_PROJECT_ID: "123" };
            jest.resetModules();
            axios.create.mockReturnValue({ post: jest.fn(), get: jest.fn() });
            const freshModule = require("../src/services/posthogExport.service");

            const first = freshModule.getInstance();
            const second = freshModule.getInstance();

            expect(first).toBe(second);
            process.env = OLD_ENV;
        });
    });
});
