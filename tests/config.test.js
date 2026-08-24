// Prevent dotenv from reading the real .env file during tests. Without
// this, deleting a var from process.env would just cause config.js to
// silently reload the real secret from disk on the next require(),
// making these "missing config" tests meaningless.
jest.mock("dotenv", () => ({ config: jest.fn() }));

const REQUIRED_KEYS = [
    "POSTHOG_HOST",
    "AI_BASE_URL",
    "POSTHOG_API_KEY",
    "POSTHOG_PROJECT_ID",
    "AI_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "ADMIN_TELEGRAM_USER_ID",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_BUCKET_NAME",
    "AWS_REGION",
    "TOMASI_API_BASE_URL",
    "TOMASI_BOT_SERVICE_API_KEY",
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET",
    "INSTAGRAM_BUSINESS_ACCOUNT_ID",
    "INSTAGRAM_ACCESS_TOKEN",
];

describe("config", () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        REQUIRED_KEYS.forEach((key) => delete process.env[key]);
    });

    afterAll(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it("rejects a non-HTTPS POSTHOG_HOST", () => {
        process.env.POSTHOG_HOST = "http://us.posthog.com";
        process.env.AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

        expect(() => require("../src/config")).toThrow(/must use HTTPS/);
    });

    it("allows http on localhost for local testing", () => {
        process.env.POSTHOG_HOST = "http://localhost:8000";
        process.env.AI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

        expect(() => require("../src/config")).not.toThrow();
    });

    it("freezes the config object to prevent runtime mutation", () => {
        const config = require("../src/config");

        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.posthog)).toBe(true);

        // Assignment on a frozen object silently no-ops in non-strict
        // mode instead of throwing, so assert the value is unchanged
        // rather than asserting a throw.
        const before = config.posthog.apiKey;
        config.posthog.apiKey = "tampered";
        expect(config.posthog.apiKey).toBe(before);
    });

    it("assertPipelineReady throws when required secrets are missing", () => {
        const config = require("../src/config");

        expect(() => config.assertPipelineReady()).toThrow(
            /Missing required environment variable/
        );
    });

    it("assertPipelineReady passes when core secrets are configured (chatId is optional for multi-group mode)", () => {
        process.env.POSTHOG_API_KEY = "phx_test";
        process.env.POSTHOG_PROJECT_ID = "123";
        process.env.AI_API_KEY = "test-ai-key";
        process.env.TELEGRAM_BOT_TOKEN = "123:abc";

        const config = require("../src/config");

        expect(() => config.assertPipelineReady()).not.toThrow();
    });

    it("assertStorageReady throws when the bucket/region are missing", () => {
        delete process.env.AWS_BUCKET_NAME;
        delete process.env.AWS_REGION;

        const config = require("../src/config");

        expect(() => config.assertStorageReady()).toThrow(/Missing required environment variable/);
    });

    it("assertStorageReady passes without static AWS keys (ECS task role use case)", () => {
        delete process.env.AWS_ACCESS_KEY_ID;
        delete process.env.AWS_SECRET_ACCESS_KEY;
        process.env.AWS_BUCKET_NAME = "test-bucket";
        process.env.AWS_REGION = "us-east-1";

        const config = require("../src/config");

        expect(() => config.assertStorageReady()).not.toThrow();
    });

    it("assertStorageReady passes when static AWS credentials are also configured (local dev)", () => {
        process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
        process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
        process.env.AWS_BUCKET_NAME = "test-bucket";
        process.env.AWS_REGION = "us-east-1";

        const config = require("../src/config");

        expect(() => config.assertStorageReady()).not.toThrow();
    });

    it("rejects a non-HTTPS TOMASI_API_BASE_URL", () => {
        process.env.TOMASI_API_BASE_URL = "http://tomasi.design";

        expect(() => require("../src/config")).toThrow(/must use HTTPS/);
    });

    it("defaults TOMASI_API_BASE_URL to the production site when unset", () => {
        const config = require("../src/config");
        expect(config.tomasiApi.baseUrl).toBe("https://tomasi.design");
    });

    it("assertTomasiApiReady throws when the service key is missing", () => {
        const config = require("../src/config");
        expect(() => config.assertTomasiApiReady()).toThrow(/TOMASI_BOT_SERVICE_API_KEY/);
    });

    it("assertTomasiApiReady passes when the service key is configured", () => {
        process.env.TOMASI_BOT_SERVICE_API_KEY = "test-key";
        const config = require("../src/config");
        expect(() => config.assertTomasiApiReady()).not.toThrow();
    });

    it("assertInstagramReady throws when credentials are missing", () => {
        const config = require("../src/config");
        expect(() => config.assertInstagramReady()).toThrow(/Missing required environment variable/);
    });

    it("assertInstagramReady passes when all Instagram credentials are configured", () => {
        process.env.INSTAGRAM_APP_ID = "app123";
        process.env.INSTAGRAM_APP_SECRET = "secret123";
        process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID = "17841400000000000";
        process.env.INSTAGRAM_ACCESS_TOKEN = "token123";

        const config = require("../src/config");
        expect(() => config.assertInstagramReady()).not.toThrow();
    });

    it("defaults adminUserId to empty when ADMIN_TELEGRAM_USER_ID is unset", () => {
        const config = require("../src/config");
        expect(config.notifications.telegram.adminUserId).toBe("");
    });

    it("reads adminUserId from ADMIN_TELEGRAM_USER_ID when set", () => {
        process.env.ADMIN_TELEGRAM_USER_ID = "6208262978";
        const config = require("../src/config");
        expect(config.notifications.telegram.adminUserId).toBe("6208262978");
    });
});
