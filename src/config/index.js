require("dotenv").config();

/**
 * Thrown when configuration is missing or malformed.
 * Kept distinct from generic errors so callers can distinguish
 * "bad deployment config" from "runtime failure".
 */
class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = "ConfigError";
    }
}

function getEnv(name, fallback = "") {
    const value = process.env[name];
    return value === undefined || value === "" ? fallback : value;
}

/**
 * Enforce that a configured URL uses HTTPS. Prevents credentials
 * (Authorization headers) from ever being sent over plaintext HTTP,
 * except for explicit localhost testing.
 */
function assertHttpsUrl(url, label) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new ConfigError(`${label} is not a valid URL: "${url}"`);
    }

    const isLoopback =
        parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

    if (parsed.protocol !== "https:" && !(isLoopback && parsed.protocol === "http:")) {
        throw new ConfigError(
            `${label} must use HTTPS (got "${parsed.protocol}") to avoid sending credentials in plaintext`
        );
    }

    return url;
}

const posthogHost = getEnv("POSTHOG_HOST", "https://us.posthog.com");
const aiBaseUrl = getEnv(
    "AI_BASE_URL",
    "https://generativelanguage.googleapis.com/v1beta/openai"
);

// Fail fast on malformed/insecure URLs at load time, before any
// service gets a chance to send credentials anywhere.
assertHttpsUrl(posthogHost, "POSTHOG_HOST");
assertHttpsUrl(aiBaseUrl, "AI_BASE_URL");

const config = {
    app: {
        environment: getEnv("NODE_ENV", "development"),
        logLevel: getEnv("LOG_LEVEL", "info"),
    },
    posthog: {
        apiKey: getEnv("POSTHOG_API_KEY"),
        projectId: getEnv("POSTHOG_PROJECT_ID"),
        host: posthogHost,
    },
    ai: {
        apiKey: getEnv("AI_API_KEY"),
        baseUrl: aiBaseUrl,
        model: getEnv("AI_MODEL", "gemini-2.5-flash"),
    },
    notifications: {
        slackBotToken: getEnv("SLACK_BOT_TOKEN"),
        telegram: {
            botToken: getEnv("TELEGRAM_BOT_TOKEN"),
            // Legacy single-chat mode, kept for backwards compatibility
            // with the original pipeline. Multi-group mode (bot added to
            // several groups, each with its own report type) is handled
            // by the group registry in src/notifications/groupRegistry.js.
            chatId: getEnv("TELEGRAM_CHAT_ID"),
        },
    },
    aws: {
        region: getEnv("AWS_REGION", "us-east-1"),
        accessKeyId: getEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY"),
        bucketName: getEnv("AWS_BUCKET_NAME"),
        // All objects this app writes live under this prefix so the
        // bucket (which is shared with other, unrelated uses per its
        // name) never gets polluted or accidentally overwritten.
        keyPrefix: getEnv("AWS_S3_KEY_PREFIX", "posthog-insights-engine"),
    },
    brand: {
        name: getEnv("BRAND_NAME", "Tomasi"),
    },
};

/**
 * Explicit fail-fast gate for the full PostHog -> AI -> Telegram pipeline.
 *
 * Deliberately NOT run automatically on module load: explorer scripts,
 * unit tests, and partial workflows only need a subset of these secrets.
 * The pipeline entrypoint calls this before doing any work so a
 * misconfigured deployment fails immediately with a clear error instead
 * of making partial API calls with empty/undefined credentials.
 */
function assertPipelineReady() {
    const missing = [];

    if (!config.posthog.apiKey) missing.push("POSTHOG_API_KEY");
    if (!config.posthog.projectId) missing.push("POSTHOG_PROJECT_ID");
    if (!config.ai.apiKey) missing.push("AI_API_KEY");
    if (!config.notifications.telegram.botToken) missing.push("TELEGRAM_BOT_TOKEN");

    if (missing.length > 0) {
        throw new ConfigError(
            `Missing required environment variable(s): ${missing.join(", ")}`
        );
    }
}

/**
 * Fail-fast gate for anything touching S3-backed report memory
 * (snapshot storage, historical comparison). Kept separate from
 * assertPipelineReady() because not every code path needs S3 (e.g.
 * a one-off query via the bot's relevance-checked Q&A).
 */
function assertStorageReady() {
    const missing = [];

    // AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are intentionally NOT
    // required here: in ECS, credentials come from the task's IAM
    // role via the SDK's default credential chain, not from static
    // env vars. They're only used as a local-dev fallback (see
    // storage/s3Snapshot.service.js and notifications/groupRegistry.js).
    if (!config.aws.bucketName) missing.push("AWS_BUCKET_NAME");
    if (!config.aws.region) missing.push("AWS_REGION");

    if (missing.length > 0) {
        throw new ConfigError(
            `Missing required environment variable(s) for S3 storage: ${missing.join(", ")}`
        );
    }
}

/**
 * Recursively freeze the config object so nothing downstream can
 * accidentally (or maliciously, via a compromised dependency) mutate
 * credentials or endpoints at runtime.
 */
function deepFreeze(obj) {
    Object.values(obj).forEach((value) => {
        if (value && typeof value === "object" && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    });
    return Object.freeze(obj);
}

// Attach helpers before freezing (freezing a function only prevents
// reassigning it, it can still be invoked normally).
config.assertPipelineReady = assertPipelineReady;
config.assertStorageReady = assertStorageReady;
config.ConfigError = ConfigError;

deepFreeze(config);

module.exports = config;
