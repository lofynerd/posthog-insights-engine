const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MB — these are small JSON responses

const NAME_PATTERN = /^.{1,100}$/;
const VALID_PLATFORMS = ["instagram", "tiktok", "youtube", "other"];
const CODE_PATTERN = /^[A-Za-z0-9]{3,20}$/;
const SLUG_PATTERN = /^[a-z0-9-]{2,40}$/;

/**
 * Client for tomasi-design's influencer/service API.
 *
 * This is the first integration in this repo that WRITES to
 * production (creates a real, working Stripe discount code) rather
 * than only reading analytics from PostHog. Treated accordingly:
 * strict input validation before the network call, a short timeout,
 * and errors surfaced clearly rather than swallowed.
 */
class TomasiApiService {
    constructor(apiConfig = config.tomasiApi) {
        this.config = apiConfig;

        if (!this.config.serviceKey) {
            throw new Error("TomasiApiService requires TOMASI_BOT_SERVICE_API_KEY to be configured");
        }

        this.client = axios.create({
            baseURL: this.config.baseUrl,
            headers: {
                Authorization: `Bearer ${this.config.serviceKey}`,
                "Content-Type": "application/json",
            },
            timeout: REQUEST_TIMEOUT_MS,
            maxContentLength: MAX_RESPONSE_BYTES,
            maxBodyLength: MAX_RESPONSE_BYTES,
            // Never follow redirects on an authenticated request -- a
            // malicious or misconfigured redirect could leak the
            // service key to an unintended host.
            maxRedirects: 0,
        });
    }

    /**
     * Create a new influencer discount code + short link.
     *
     * @param {object} params
     * @param {string} params.name
     * @param {string} [params.platform] - instagram/tiktok/youtube/other
     * @param {number} params.discountPercent - 1-90
     * @param {string} [params.code] - custom code; auto-generated from name if omitted
     * @param {string} [params.slug] - custom short-link slug; auto-generated if omitted
     * @param {number} [params.agreedFee] - what we're paying the influencer, for ROI reporting
     * @returns {Promise<object>} The created influencer record (code, shortLink, etc.)
     */
    async createInfluencer(params) {
        this._validateCreateParams(params);

        try {
            const response = await this.client.post("/api/service/influencers", params);
            logger.info("Influencer code created", { slug: response.data?.influencer?.slug });
            return response.data.influencer;
        } catch (error) {
            const detail = error.response?.data?.message || error.message;
            logger.error("Failed to create influencer code", detail);
            throw new Error(`Failed to create influencer code: ${detail}`);
        }
    }

    /**
     * List all influencer records (for /influencer list and campaign
     * reporting).
     */
    async listInfluencers() {
        try {
            const response = await this.client.get("/api/service/influencers");
            return response.data.influencers || [];
        } catch (error) {
            const detail = error.response?.data?.message || error.message;
            logger.error("Failed to list influencers", detail);
            throw new Error(`Failed to list influencers: ${detail}`);
        }
    }

    /**
     * Update an existing influencer's platform and/or agreed fee.
     * Does not touch the code, slug, or discount percent -- those are
     * the discount's actual terms and shouldn't change silently after
     * an influencer has started sharing the code.
     *
     * Exists specifically so a campaign's cost (and therefore ROI --
     * see metrics/campaign.js's computeRoiPercent()) can be set or
     * corrected after creation, since /influencer add doesn't require
     * either field up front.
     *
     * @param {string} slug
     * @param {object} params
     * @param {string} [params.platform] - instagram/tiktok/youtube/other
     * @param {number} [params.agreedFee] - what we're paying the influencer, for ROI reporting
     * @returns {Promise<object>} The updated influencer record.
     */
    async updateInfluencer(slug, params) {
        if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
            throw new Error("Invalid slug");
        }
        this._validateUpdateParams(params);

        try {
            const response = await this.client.patch(`/api/service/influencers/${slug}`, params);
            logger.info("Influencer updated", { slug });
            return response.data.influencer;
        } catch (error) {
            const detail = error.response?.data?.message || error.message;
            logger.error("Failed to update influencer", detail);
            throw new Error(`Failed to update influencer: ${detail}`);
        }
    }

    /**
     * Deactivate an influencer's discount code.
     */
    async disableInfluencer(slug) {
        if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
            throw new Error("Invalid slug");
        }

        try {
            const response = await this.client.patch(`/api/service/influencers/${slug}/disable`);
            return response.data;
        } catch (error) {
            const detail = error.response?.data?.message || error.message;
            logger.error("Failed to disable influencer code", detail);
            throw new Error(`Failed to disable influencer code: ${detail}`);
        }
    }

    /**
     * Validate influencer-creation input before it ever reaches the
     * network call. Mirrors the server-side validation in
     * tomasi-design's influencer.controller.js -- defense in depth,
     * and gives the Telegram bot a fast, clear error instead of a
     * round-trip failure for obviously bad input.
     * @private
     */
    _validateCreateParams({ name, platform, discountPercent, code, slug, agreedFee }) {
        if (typeof name !== "string" || !NAME_PATTERN.test(name.trim())) {
            throw new Error("A valid influencer name is required.");
        }
        if (platform !== undefined && !VALID_PLATFORMS.includes(platform)) {
            throw new Error(`platform must be one of: ${VALID_PLATFORMS.join(", ")}`);
        }
        const discount = Number(discountPercent);
        if (!Number.isInteger(discount) || discount < 1 || discount > 90) {
            throw new Error("discountPercent must be an integer between 1 and 90.");
        }
        if (code !== undefined && !CODE_PATTERN.test(code)) {
            throw new Error("code must be 3-20 alphanumeric characters.");
        }
        if (slug !== undefined && !SLUG_PATTERN.test(slug)) {
            throw new Error("slug must be 2-40 lowercase letters/numbers/hyphens.");
        }
        if (agreedFee !== undefined && agreedFee !== null) {
            const fee = Number(agreedFee);
            if (!Number.isFinite(fee) || fee < 0) {
                throw new Error("agreedFee must be a non-negative number.");
            }
        }
    }

    /**
     * Validate influencer-update input before it ever reaches the
     * network call. Mirrors tomasi-design's updateInfluencer
     * controller validation.
     * @private
     */
    _validateUpdateParams({ platform, agreedFee } = {}) {
        if (platform === undefined && agreedFee === undefined) {
            throw new Error("Provide at least one of: platform, agreedFee.");
        }
        if (platform !== undefined && !VALID_PLATFORMS.includes(platform)) {
            throw new Error(`platform must be one of: ${VALID_PLATFORMS.join(", ")}`);
        }
        if (agreedFee !== undefined && agreedFee !== null) {
            const fee = Number(agreedFee);
            if (!Number.isFinite(fee) || fee < 0) {
                throw new Error("agreedFee must be a non-negative number.");
            }
        }
    }
}

// Lazily instantiated: unlike this repo's other service singletons,
// this integration is optional (only the /influencer and /campaign
// bot commands need it) and writes to production. Constructing it
// eagerly at require() time would mean a missing
// TOMASI_BOT_SERVICE_API_KEY breaks every test/tool that transitively
// requires this module, not just the commands that actually use it.
let singleton = null;

function getInstance() {
    if (!singleton) {
        singleton = new TomasiApiService();
    }
    return singleton;
}

module.exports = { getInstance, TomasiApiService };
