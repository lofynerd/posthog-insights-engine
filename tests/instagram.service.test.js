jest.mock("axios", () => ({
    create: jest.fn(),
}));

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const axios = require("axios");
const instagramModule = require("../src/services/instagram.service");
const { InstagramService } = instagramModule;

function buildConfig(overrides = {}) {
    return {
        appId: "app123",
        appSecret: "secret123",
        businessAccountId: "17841400000000000",
        accessToken: "initial-token",
        apiVersion: "v21.0",
        ...overrides,
    };
}

describe("InstagramService", () => {
    afterEach(() => jest.clearAllMocks());

    function buildService(get, configOverrides) {
        axios.create.mockReturnValue({ get });
        return new InstagramService(buildConfig(configOverrides));
    }

    it("throws if constructed without app id/secret", () => {
        expect(() => new InstagramService(buildConfig({ appId: "" }))).toThrow(/INSTAGRAM_APP_ID/);
    });

    it("throws if constructed without business account id/access token", () => {
        expect(() => new InstagramService(buildConfig({ businessAccountId: "" }))).toThrow(
            /INSTAGRAM_BUSINESS_ACCOUNT_ID/
        );
    });

    describe("refreshAccessToken", () => {
        it("updates the in-memory token on success", async () => {
            const get = jest.fn().mockResolvedValue({ data: { access_token: "new-token", expires_in: 5184000 } });
            const service = buildService(get);

            const result = await service.refreshAccessToken();

            expect(result).toBe("new-token");
            expect(get).toHaveBeenCalledWith(
                "https://graph.instagram.com/refresh_access_token",
                expect.objectContaining({
                    params: expect.objectContaining({ grant_type: "ig_refresh_token", access_token: "initial-token" }),
                })
            );
        });

        it("throws a clear error on failure", async () => {
            const get = jest.fn().mockRejectedValue(new Error("network down"));
            const service = buildService(get);

            await expect(service.refreshAccessToken()).rejects.toThrow("Failed to refresh Instagram access token");
        });

        it("subsequent calls use the refreshed token", async () => {
            const get = jest
                .fn()
                .mockResolvedValueOnce({ data: { access_token: "refreshed-token" } })
                .mockResolvedValueOnce({ data: { data: [] } });
            const service = buildService(get);

            await service.refreshAccessToken();
            await service.getAccountInsights();

            const secondCallParams = get.mock.calls[1][1].params;
            expect(secondCallParams.access_token).toBe("refreshed-token");
        });
    });

    describe("getAccountInsights", () => {
        it("parses the Meta insights response shape into a flat object", async () => {
            const get = jest.fn().mockResolvedValue({
                data: {
                    data: [
                        { name: "reach", values: [{ value: 100 }, { value: 150 }] },
                        { name: "accounts_engaged", values: [{ value: 20 }] },
                    ],
                },
            });
            const service = buildService(get);

            const result = await service.getAccountInsights();

            expect(result).toEqual({ reach: 150, accounts_engaged: 20 });
        });

        it("throws a clear error on API failure", async () => {
            const get = jest.fn().mockRejectedValue({ response: { data: { error: { message: "bad token" } } } });
            const service = buildService(get);

            await expect(service.getAccountInsights()).rejects.toThrow("Instagram account insights request failed");
        });
    });

    describe("listRecentMedia", () => {
        it("returns the media array", async () => {
            const get = jest.fn().mockResolvedValue({ data: { data: [{ id: "1" }, { id: "2" }] } });
            const service = buildService(get);

            const result = await service.listRecentMedia();

            expect(result).toHaveLength(2);
        });

        it("clamps an out-of-range limit to the default", async () => {
            const get = jest.fn().mockResolvedValue({ data: { data: [] } });
            const service = buildService(get);

            await service.listRecentMedia(500);

            expect(get.mock.calls[0][1].params.limit).toBe(25);
        });
    });

    describe("getMediaInsights", () => {
        it("rejects a non-numeric media ID", async () => {
            const get = jest.fn();
            const service = buildService(get);

            await expect(service.getMediaInsights("not-a-valid-id")).rejects.toThrow("Invalid media ID");
            expect(get).not.toHaveBeenCalled();
        });

        it("returns an empty object for the 'not enough viewers' error instead of throwing", async () => {
            const get = jest.fn().mockRejectedValue({ response: { data: { error: { code: 10 } } } });
            const service = buildService(get);

            const result = await service.getMediaInsights("123456789");

            expect(result).toEqual({});
        });

        it("throws for other API errors", async () => {
            const get = jest.fn().mockRejectedValue({ response: { data: { error: { code: 999 } } } });
            const service = buildService(get);

            await expect(service.getMediaInsights("123456789")).rejects.toThrow(
                "Instagram media insights request failed"
            );
        });

        it("parses successful media insights", async () => {
            const get = jest.fn().mockResolvedValue({
                data: { data: [{ name: "likes", values: [{ value: 42 }] }] },
            });
            const service = buildService(get);

            const result = await service.getMediaInsights("123456789");

            expect(result).toEqual({ likes: 42 });
        });
    });

    describe("getInstance", () => {
        it("returns the same instance on repeated calls", () => {
            const OLD_ENV = process.env;
            process.env = {
                ...OLD_ENV,
                INSTAGRAM_APP_ID: "app123",
                INSTAGRAM_APP_SECRET: "secret123",
                INSTAGRAM_BUSINESS_ACCOUNT_ID: "17841400000000000",
                INSTAGRAM_ACCESS_TOKEN: "token123",
            };
            jest.resetModules();
            axios.create.mockReturnValue({ get: jest.fn() });
            const freshModule = require("../src/services/instagram.service");

            const first = freshModule.getInstance();
            const second = freshModule.getInstance();

            expect(first).toBe(second);
            process.env = OLD_ENV;
        });
    });
});
