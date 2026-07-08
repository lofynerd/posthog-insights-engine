const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const config = require("../config");
const logger = require("../utils/logger");

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024; // 5 MB safety cap per snapshot

// Only allow a fixed, known set of path segment characters. This
// bucket is shared with unrelated Vercel image assets, so a strict
// allow-list here is what stands between a bad groupName/reportType
// value and writing/reading outside our intended prefix (path
// traversal via "..", absolute paths, or arbitrary key injection).
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9 _.-]{1,100}$/;

function assertSafeSegment(value, label) {
    if (typeof value !== "string" || !SAFE_SEGMENT_PATTERN.test(value)) {
        throw new Error(
            `Invalid ${label}: must be a short alphanumeric string (got "${value}")`
        );
    }
    if (value.includes("..") || value.startsWith("/") || value.startsWith(".")) {
        throw new Error(`Invalid ${label}: unsafe path segment`);
    }
    return value;
}

/**
 * S3-backed report memory.
 *
 * Stores and retrieves immutable JSON snapshots of AI reports and raw
 * metrics, organized as:
 *
 *   {keyPrefix}/{groupName}/{reportType}/{YYYY-MM-DD}.json
 *
 * groupName comes from the Telegram group's registered display name
 * (see notifications/groupRegistry.js), sanitized before ever
 * reaching this module.
 */
class S3SnapshotService {
    constructor(awsConfig = config.aws) {
        this.config = awsConfig;
        this.client = new S3Client({
            region: this.config.region,
            // Only pass explicit static credentials when both are
            // configured (local dev via .env). In ECS, neither is
            // set and the SDK's default credential provider chain
            // picks up the task's IAM role automatically — short-lived,
            // auto-rotating credentials instead of long-lived static
            // keys baked into the environment.
            ...(this.config.accessKeyId && this.config.secretAccessKey
                ? {
                      credentials: {
                          accessKeyId: this.config.accessKeyId,
                          secretAccessKey: this.config.secretAccessKey,
                      },
                  }
                : {}),
            requestHandler: {
                requestTimeout: REQUEST_TIMEOUT_MS,
            },
        });
    }

    _buildKey(groupName, reportType, dateKey) {
        assertSafeSegment(groupName, "groupName");
        assertSafeSegment(reportType, "reportType");
        assertSafeSegment(dateKey, "dateKey");

        return `${this.config.keyPrefix}/${groupName}/${reportType}/${dateKey}.json`;
    }

    /**
     * Persist a report snapshot. Snapshots are treated as immutable:
     * once written for a given group/type/date, callers should not
     * expect to overwrite the same key with different data, though
     * S3 itself doesn't enforce that here (no object-lock configured).
     *
     * @param {object} params
     * @param {string} params.groupName - Sanitized Telegram group display name.
     * @param {string} params.reportType - e.g. "founder", "marketing", "pr", "developer".
     * @param {string} params.dateKey - ISO date, e.g. "2026-07-08".
     * @param {object} params.payload - JSON-serializable snapshot data.
     */
    async putSnapshot({ groupName, reportType, dateKey, payload }) {
        const key = this._buildKey(groupName, reportType, dateKey);
        const body = JSON.stringify(payload);

        if (Buffer.byteLength(body, "utf8") > MAX_SNAPSHOT_BYTES) {
            throw new Error("Snapshot payload exceeds maximum allowed size");
        }

        try {
            await this.client.send(
                new PutObjectCommand({
                    Bucket: this.config.bucketName,
                    Key: key,
                    Body: body,
                    ContentType: "application/json",
                    // Snapshots are internal analytics data, not public
                    // assets like the rest of this bucket — do not rely
                    // on bucket defaults, be explicit.
                    ACL: "private",
                    ServerSideEncryption: "AES256",
                })
            );

            logger.info("Snapshot stored in S3", { key });
            return key;
        } catch (error) {
            logger.error("Failed to store snapshot in S3", error.message);
            throw new Error("Failed to store snapshot in S3");
        }
    }

    /**
     * Retrieve a single snapshot if it exists. Returns null on a
     * missing object instead of throwing, so callers can implement
     * "fetch from PostHog only if not already cached" logic.
     */
    async getSnapshot({ groupName, reportType, dateKey }) {
        const key = this._buildKey(groupName, reportType, dateKey);

        try {
            const response = await this.client.send(
                new GetObjectCommand({ Bucket: this.config.bucketName, Key: key })
            );

            const body = await this._streamToString(response.Body, MAX_SNAPSHOT_BYTES);
            return JSON.parse(body);
        } catch (error) {
            if (error.name === "NoSuchKey") {
                return null;
            }
            logger.error("Failed to read snapshot from S3", error.message);
            throw new Error("Failed to read snapshot from S3");
        }
    }

    /**
     * List available snapshot dates for a group/report type, most
     * recent first. Used for weekly/monthly/quarterly comparisons.
     */
    async listSnapshotDates({ groupName, reportType }, limit = 50) {
        assertSafeSegment(groupName, "groupName");
        assertSafeSegment(reportType, "reportType");

        const prefix = `${this.config.keyPrefix}/${groupName}/${reportType}/`;
        const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 1000 ? limit : 50;

        try {
            const response = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.config.bucketName,
                    Prefix: prefix,
                    MaxKeys: safeLimit,
                })
            );

            const dates = (response.Contents || [])
                .map((obj) => obj.Key.slice(prefix.length).replace(/\.json$/, ""))
                .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey))
                .sort()
                .reverse();

            return dates;
        } catch (error) {
            logger.error("Failed to list snapshots in S3", error.message);
            throw new Error("Failed to list snapshots in S3");
        }
    }

    /**
     * Read a ReadableStream/Blob response body into a size-bounded
     * UTF-8 string. Guards against an unexpectedly huge object
     * exhausting memory.
     * @private
     */
    async _streamToString(stream, maxBytes) {
        const chunks = [];
        let total = 0;

        for await (const chunk of stream) {
            total += chunk.length;
            if (total > maxBytes) {
                throw new Error("Snapshot object exceeds maximum allowed size");
            }
            chunks.push(chunk);
        }

        return Buffer.concat(chunks).toString("utf8");
    }
}

module.exports = new S3SnapshotService();
module.exports.S3SnapshotService = S3SnapshotService;
