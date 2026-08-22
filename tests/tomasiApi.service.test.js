jest.mock("axios", () => ({
    create: jest.fn(),
}));

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const axios = require("axios");
const tomasiApiModule = require("../src/services/tomasiApi.service");
const { TomasiApiService } = tomasiApiModule;

describe("TomasiApiService", () => {
    afterEach(() => jest.clearAllMocks());

    function buildService({ post, get, patch } = {}) {
        axios.create.mockReturnValue({
            post: post || jest.fn(),
            get: get || jest.fn(),
            patch: patch || jest.fn(),
        });
        return new TomasiApiService({
            baseUrl: "https://tomasi.design",
            serviceKey: "test-service-key",
        });
    }

    it("throws if constructed without a service key", () => {
        expect(() => new TomasiApiService({ baseUrl: "https://tomasi.design" })).toThrow(
            /TOMASI_BOT_SERVICE_API_KEY/
        );
    });

    describe("getInstance", () => {
        const OLD_ENV = process.env;

        afterEach(() => {
            process.env = OLD_ENV;
        });

        it("throws when TOMASI_BOT_SERVICE_API_KEY is not configured, without breaking the module import itself", () => {
            process.env = { ...OLD_ENV, TOMASI_BOT_SERVICE_API_KEY: "" };
            jest.resetModules();
            const freshModule = require("../src/services/tomasiApi.service");

            expect(() => freshModule.getInstance()).toThrow(/TOMASI_BOT_SERVICE_API_KEY/);
        });

        it("returns the same instance on repeated calls (singleton)", () => {
            process.env = { ...OLD_ENV, TOMASI_BOT_SERVICE_API_KEY: "test-key", TOMASI_API_BASE_URL: "https://tomasi.design" };
            jest.resetModules();
            const freshModule = require("../src/services/tomasiApi.service");

            const first = freshModule.getInstance();
            const second = freshModule.getInstance();

            expect(first).toBe(second);
        });
    });

    describe("createInfluencer", () => {
        it("rejects a missing name before making a network call", async () => {
            const post = jest.fn();
            const service = buildService({ post });

            await expect(service.createInfluencer({ discountPercent: 10 })).rejects.toThrow(
                /valid influencer name/
            );
            expect(post).not.toHaveBeenCalled();
        });

        it("rejects an invalid platform", async () => {
            const post = jest.fn();
            const service = buildService({ post });

            await expect(
                service.createInfluencer({ name: "Jane", platform: "snapchat", discountPercent: 10 })
            ).rejects.toThrow(/platform must be one of/);
            expect(post).not.toHaveBeenCalled();
        });

        it("rejects a discount outside 1-90", async () => {
            const post = jest.fn();
            const service = buildService({ post });

            await expect(service.createInfluencer({ name: "Jane", discountPercent: 0 })).rejects.toThrow(
                /between 1 and 90/
            );
            await expect(service.createInfluencer({ name: "Jane", discountPercent: 95 })).rejects.toThrow(
                /between 1 and 90/
            );
        });

        it("rejects a malformed custom code", async () => {
            const post = jest.fn();
            const service = buildService({ post });

            await expect(
                service.createInfluencer({ name: "Jane", discountPercent: 10, code: "a!" })
            ).rejects.toThrow(/code must be/);
        });

        it("rejects a malformed custom slug", async () => {
            const post = jest.fn();
            const service = buildService({ post });

            await expect(
                service.createInfluencer({ name: "Jane", discountPercent: 10, slug: "not a slug" })
            ).rejects.toThrow(/slug must be/);
        });

        it("rejects a negative agreedFee", async () => {
            const post = jest.fn();
            const service = buildService({ post });

            await expect(
                service.createInfluencer({ name: "Jane", discountPercent: 10, agreedFee: -1 })
            ).rejects.toThrow(/non-negative/);
        });

        it("posts valid params and returns the created influencer", async () => {
            const post = jest.fn().mockResolvedValue({
                data: { influencer: { name: "Jane", code: "JANE10", slug: "jane", shortLink: "https://tomasi.design/go/jane" } },
            });
            const service = buildService({ post });

            const result = await service.createInfluencer({ name: "Jane", discountPercent: 10 });

            expect(post).toHaveBeenCalledWith(
                "/api/service/influencers",
                expect.objectContaining({ name: "Jane", discountPercent: 10 })
            );
            expect(result.code).toBe("JANE10");
        });

        it("surfaces the server's error message on failure", async () => {
            const post = jest.fn().mockRejectedValue({
                response: { data: { message: "Code already exists" } },
            });
            const service = buildService({ post });

            await expect(service.createInfluencer({ name: "Jane", discountPercent: 10 })).rejects.toThrow(
                "Code already exists"
            );
        });
    });

    describe("listInfluencers", () => {
        it("returns the influencer list", async () => {
            const get = jest.fn().mockResolvedValue({ data: { influencers: [{ name: "Jane" }] } });
            const service = buildService({ get });

            const result = await service.listInfluencers();

            expect(result).toEqual([{ name: "Jane" }]);
        });

        it("returns an empty array when the response has none", async () => {
            const get = jest.fn().mockResolvedValue({ data: {} });
            const service = buildService({ get });

            const result = await service.listInfluencers();

            expect(result).toEqual([]);
        });
    });

    describe("disableInfluencer", () => {
        it("rejects an invalid slug before making a network call", async () => {
            const patch = jest.fn();
            const service = buildService({ patch });

            await expect(service.disableInfluencer("not a slug!")).rejects.toThrow(/Invalid slug/);
            expect(patch).not.toHaveBeenCalled();
        });

        it("patches the disable endpoint for a valid slug", async () => {
            const patch = jest.fn().mockResolvedValue({ data: { message: "disabled" } });
            const service = buildService({ patch });

            const result = await service.disableInfluencer("jane-doe");

            expect(patch).toHaveBeenCalledWith("/api/service/influencers/jane-doe/disable");
            expect(result.message).toBe("disabled");
        });
    });
});
