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
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_BUCKET_NAME",
    "AWS_REGION",
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
});
