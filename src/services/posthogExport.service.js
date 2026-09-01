const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

const REQUEST_TIMEOUT_MS = 25_000;
// Dashboard/insight PNG exports can run several hundred KB to a few
// MB depending on chart complexity -- cap well above what's realistic
// to bound memory use if PostHog ever returns something unexpected.
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * PostHog Export Service
 *
 * Renders a real PostHog insight (an actual chart from the "Tomasi AI
 * Report Coverage" dashboard, or any other insight in the project) as
 * a PNG, using PostHog's own server-side chart renderer via the
 * Exports API -- not a re-implementation of the chart.
 *
 * https://posthog.com/docs/api/exports -- POST creates an export job
 * (synchronous in practice: has_content is true immediately in every
 * case observed), then GET .../content/ downloads the actual bytes.
 */
class PostHogExportService {
    constructor(posthogConfig = config.posthog) {
        this.config = posthogConfig;

        if (!this.config.apiKey || !this.config.projectId) {
            throw new Error("PostHogExportService requires apiKey and projectId to be configured");
        }

        this.client = axios.create({
            baseURL: `${this.config.host}/api/projects/${encodeURIComponent(this.config.projectId)}`,
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                "Content-Type": "application/json",
            },
            timeout: REQUEST_TIMEOUT_MS,
            maxContentLength: MAX_RESPONSE_BYTES,
            maxBodyLength: MAX_RESPONSE_BYTES,
            maxRedirects: 0,
        });
    }

    /**
     * Render one insight as a PNG and return the raw image bytes.
     *
     * @param {number} insightId - A real PostHog insight ID.
     * @returns {Promise<Buffer>} PNG image bytes.
     */
    async exportInsightPng(insightId) {
        if (!Number.isInteger(insightId) || insightId <= 0) {
            throw new Error("Invalid insight ID");
        }

        let exportRecord;
        try {
            const createResponse = await this.client.post("/exports/", {
                export_format: "image/png",
                insight: insightId,
            });
            exportRecord = createResponse.data;
        } catch (error) {
            logger.error("PostHog export creation failed", error.response?.data || error.message);
            throw new Error("PostHog export creation failed");
        }

        if (exportRecord.exception) {
            // PostHog returns 201 even when the underlying query fails
            // (e.g. a malformed HogQL insight) -- has_content stays
            // false and `exception` carries the real error.
            logger.error("PostHog export failed server-side", exportRecord.exception);
            throw new Error(`PostHog export failed: ${exportRecord.exception}`);
        }

        try {
            // The export content endpoint has been observed returning
            // the PNG bytes BOTH ways: sometimes a direct 200 with the
            // image body, sometimes a 302 redirect to a signed,
            // unauthenticated S3 URL. Handle both rather than assuming
            // one -- this.client blocks auto-following redirects on
            // every OTHER request specifically to stop our PostHog
            // Authorization header leaking to an unintended host, so
            // on a 302 the S3 URL is fetched as a completely separate,
            // unauthenticated request instead of letting axios
            // auto-follow (which would resend our Authorization header
            // to S3, defeating the point of maxRedirects:0).
            const response = await this.client.get(`/exports/${exportRecord.id}/content/`, {
                responseType: "arraybuffer",
                validateStatus: (status) => status === 200 || status === 302,
            });

            if (response.status === 200) {
                return Buffer.from(response.data);
            }

            const location = response.headers.location;
            if (!location) {
                throw new Error("PostHog export redirect had no Location header");
            }

            const contentResponse = await axios.get(location, {
                responseType: "arraybuffer",
                timeout: REQUEST_TIMEOUT_MS,
                maxContentLength: MAX_RESPONSE_BYTES,
                maxBodyLength: MAX_RESPONSE_BYTES,
                maxRedirects: 0,
            });
            return Buffer.from(contentResponse.data);
        } catch (error) {
            logger.error("PostHog export download failed", error.response?.data || error.message);
            throw new Error("PostHog export download failed");
        }
    }
}

// Lazily instantiated, same rationale as the other optional service
// singletons in this repo: reuses the same PostHog credentials as
// posthog.service.js, so no NEW required env var -- but keeping it
// lazy means a transient issue only breaks the chart-attachment path,
// not every report.
let singleton = null;

function getInstance() {
    if (!singleton) {
        singleton = new PostHogExportService();
    }
    return singleton;
}

module.exports = { getInstance, PostHogExportService };
