const {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
} = require("@aws-sdk/client-s3");
const config = require("../config");
const logger = require("../utils/logger");
const { isValidReportType } = require("../ai/reportTypes");

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REGISTRY_BYTES = 512 * 1024; // 512 KB is generous for a chat->group map
const REGISTRY_KEY = `${config.aws.keyPrefix}/registry/groups.json`;

// Bounds on user-controlled group display names before they're used
// as S3 path segments (see storage/s3Snapshot.service.js's own
// stricter validation, which is the real enforcement point — this is
// an earlier, friendlier check so bad input fails fast with a clear
// Telegram-side error instead of a raw S3 error).
const GROUP_NAME_PATTERN = /^[A-Za-z0-9 _.-]{1,60}$/;

/**
 * Group Registry
 *
 * Maps Telegram chat IDs (the bot has been added to 4 group types) to
 * a sanitized group name + assigned report type. Persisted in S3 so
 * the mapping survives process restarts without requiring a database.
 *
 * Registration happens via the bot's /register command (admin-only
 * in practice, since it determines what report type a group gets)
 * rather than being inferred automatically, since Telegram doesn't
 * expose "group category" — only a title the bot can't fully trust.
 */
class GroupRegistry {
    constructor(awsConfig = config.aws) {
        this.config = awsConfig;
        this.client = new S3Client({
            region: this.config.region,
            // Same rationale as S3SnapshotService: fall back to the
            // SDK's default credential chain (ECS task role) when no
            // static keys are configured.
            ...(this.config.accessKeyId && this.config.secretAccessKey
                ? {
                      credentials: {
                          accessKeyId: this.config.accessKeyId,
                          secretAccessKey: this.config.secretAccessKey,
                      },
                  }
                : {}),
            requestHandler: { requestTimeout: REQUEST_TIMEOUT_MS },
        });
        this._cache = null;
    }

    async _load() {
        if (this._cache) {
            return this._cache;
        }

        try {
            const response = await this.client.send(
                new GetObjectCommand({ Bucket: this.config.bucketName, Key: REGISTRY_KEY })
            );
            const body = await this._streamToString(response.Body, MAX_REGISTRY_BYTES);
            this._cache = JSON.parse(body);
        } catch (error) {
            if (error.name === "NoSuchKey") {
                this._cache = {};
            } else {
                logger.error("Failed to load group registry from S3", error.message);
                throw new Error("Failed to load group registry");
            }
        }

        return this._cache;
    }

    async _save(registry) {
        const body = JSON.stringify(registry);
        if (Buffer.byteLength(body, "utf8") > MAX_REGISTRY_BYTES) {
            throw new Error("Group registry exceeds maximum allowed size");
        }

        await this.client.send(
            new PutObjectCommand({
                Bucket: this.config.bucketName,
                Key: REGISTRY_KEY,
                Body: body,
                ContentType: "application/json",
                ACL: "private",
                ServerSideEncryption: "AES256",
            })
        );

        this._cache = registry;
    }

    /**
     * Register (or update) a Telegram chat as a named report group.
     *
     * @param {string|number} chatId
     * @param {string} groupName - Sanitized display name, used as an S3 path segment.
     * @param {string} reportType - One of founder/marketing/pr/developer.
     */
    async registerGroup(chatId, groupName, reportType) {
        if (!/^-?\d+$/.test(String(chatId))) {
            throw new Error("chatId must be numeric");
        }
        if (!GROUP_NAME_PATTERN.test(groupName)) {
            throw new Error(
                "groupName must be 1-60 characters, letters/numbers/spaces/._- only"
            );
        }
        if (!isValidReportType(reportType)) {
            throw new Error(`Invalid reportType "${reportType}"`);
        }

        const registry = await this._load();
        registry[String(chatId)] = { groupName, reportType, updatedAt: new Date().toISOString() };
        await this._save(registry);

        logger.info("Group registered", { chatId, groupName, reportType });
        return registry[String(chatId)];
    }

    /**
     * Look up the registered group name + report type for a chat ID.
     * Returns null if the chat has not been registered.
     */
    async getGroup(chatId) {
        const registry = await this._load();
        return registry[String(chatId)] || null;
    }

    /**
     * List all registered groups (chatId -> config). Used by the
     * scheduler to fan out scheduled reports to every registered group.
     */
    async listGroups() {
        const registry = await this._load();
        return Object.entries(registry).map(([chatId, entry]) => ({ chatId, ...entry }));
    }

    async _streamToString(stream, maxBytes) {
        const chunks = [];
        let total = 0;
        for await (const chunk of stream) {
            total += chunk.length;
            if (total > maxBytes) {
                throw new Error("Registry object exceeds maximum allowed size");
            }
            chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString("utf8");
    }
}

module.exports = new GroupRegistry();
module.exports.GroupRegistry = GroupRegistry;
