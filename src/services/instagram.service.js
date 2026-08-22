const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

// Metrics available on the account-level /insights endpoint.
// "profile_views" was deprecated January 8, 2025 -- "accounts_engaged"
// is its closest modern replacement (accounts that interacted with
// content, rather than raw profile visits).
const ACCOUNT_METRICS = ["reach", "accounts_engaged", "follower_count"];

// Metrics available on individual media (FEED/REELS) insights.
const MEDIA_METRICS = ["reach", "likes", "comments", "saved", "shares", "total_interactions", "views"];

/**
 * Instagram Graph API client, using the "Instagram API with Instagram
 * Login" flow (Business Login for Instagram) -- the correct flow for
 * a standalone Instagram app (like "tomasi-app-IG") that isn't a
 * product added to a separate Facebook-type Meta app. All requests
 * go to graph.instagram.com using an Instagram User access token, not
 * graph.facebook.com with a Facebook User access token -- there is no
 * Facebook Page involved anywhere in this flow.
 *
 * Read-only: this integration only reads organic reach/engagement
 * metrics for the Tomasi Business account. It never posts, comments,
 * likes, or modifies anything on Instagram.
 *
 * Handles long-lived token refresh automatically -- Instagram's
 * long-lived tokens last ~60 days and can be refreshed for another
 * ~60 days at any point after the first 24 hours and before they
 * expire, extending indefinitely as long as the bot keeps running and
 * calling this service periodically.
 */
class InstagramService {
    constructor(igConfig = config.instagram) {
        this.config = igConfig;

        if (!this.config.appId || !this.config.appSecret) {
            throw new Error("InstagramService requires INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to be configured");
        }
        if (!this.config.businessAccountId || !this.config.accessToken) {
            throw new Error(
                "InstagramService requires INSTAGRAM_BUSINESS_ACCOUNT_ID and INSTAGRAM_ACCESS_TOKEN to be configured. " +
                    "Run `node scripts/instagramAuth.js` once to obtain these."
            );
        }

        // Mutable at runtime: refreshAccessToken() updates this after
        // a successful refresh, so subsequent calls in the same
        // process use the fresh token without requiring a restart.
        this._accessToken = this.config.accessToken;

        this.client = axios.create({
            baseURL: `https://graph.instagram.com/${this.config.apiVersion}`,
            timeout: REQUEST_TIMEOUT_MS,
            maxContentLength: MAX_RESPONSE_BYTES,
            maxBodyLength: MAX_RESPONSE_BYTES,
            maxRedirects: 0,
        });
    }

    /**
     * Refresh the long-lived access token, extending its validity by
     * another ~60 days. Safe to call anytime after the current token
     * is at least 24 hours old and before it expires -- Instagram
     * explicitly supports refreshing a still-valid long-lived token to
     * get a new ~60-day window. Unlike the Facebook Login flow, this
     * does NOT require the app secret or app ID, only the token itself.
     *
     * Does NOT persist the new token anywhere outside this process's
     * memory -- on restart, the original INSTAGRAM_ACCESS_TOKEN env
     * var is used again. If that one has since expired, rerun
     * scripts/instagramAuth.js. Persisting refreshed tokens back to
     * Secrets Manager automatically is a reasonable future
     * improvement, not implemented here to avoid this service
     * needing AWS write permissions for what is otherwise a read-only
     * integration.
     */
    async refreshAccessToken() {
        try {
            // Unversioned endpoint (per Meta's docs) -- unlike the
            // data endpoints below, this one is not prefixed with an
            // API version, so it's called via an absolute URL rather
            // than through this.client's versioned baseURL.
            const response = await this.client.get("https://graph.instagram.com/refresh_access_token", {
                params: {
                    grant_type: "ig_refresh_token",
                    access_token: this._accessToken,
                },
            });

            this._accessToken = response.data.access_token;
            logger.info("Instagram access token refreshed successfully");
            return this._accessToken;
        } catch (error) {
            logger.error("Failed to refresh Instagram access token", error.response?.data || error.message);
            throw new Error("Failed to refresh Instagram access token");
        }
    }

    /**
     * Account-level insights: reach, accounts engaged, follower count.
     *
     * @param {string} [period="day"] - day/week/days_28
     * @param {number} [days=30] - how many days of daily data points to request (via `since`/`until`)
     */
    async getAccountInsights(period = "day", days = 30) {
        const until = Math.floor(Date.now() / 1000);
        const since = until - days * 86400;

        try {
            const response = await this.client.get(`/${this.config.businessAccountId}/insights`, {
                params: {
                    metric: ACCOUNT_METRICS.join(","),
                    period,
                    since,
                    until,
                    access_token: this._accessToken,
                },
            });

            return this._parseInsightsResponse(response.data);
        } catch (error) {
            logger.error("Instagram account insights request failed", error.response?.data || error.message);
            throw new Error("Instagram account insights request failed");
        }
    }

    /**
     * List recent media (posts/reels) with basic metadata, most recent first.
     *
     * @param {number} [limit=25]
     */
    async listRecentMedia(limit = 25) {
        const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 25;

        try {
            const response = await this.client.get(`/${this.config.businessAccountId}/media`, {
                params: {
                    fields: "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count",
                    limit: safeLimit,
                    access_token: this._accessToken,
                },
            });

            return response.data.data || [];
        } catch (error) {
            logger.error("Instagram media list request failed", error.response?.data || error.message);
            throw new Error("Instagram media list request failed");
        }
    }

    /**
     * Per-post insights (reach, likes, comments, saves, shares,
     * total_interactions) for one media item.
     *
     * @param {string} mediaId
     */
    async getMediaInsights(mediaId) {
        if (typeof mediaId !== "string" || !/^\d+$/.test(mediaId)) {
            throw new Error("Invalid media ID");
        }

        try {
            const response = await this.client.get(`/${mediaId}/insights`, {
                params: {
                    metric: MEDIA_METRICS.join(","),
                    access_token: this._accessToken,
                },
            });

            return this._parseInsightsResponse(response.data);
        } catch (error) {
            // Media insights commonly 400 for very recent/low-reach
            // posts ("Not enough viewers") -- surface as an empty
            // result rather than throwing, so a report covering many
            // posts doesn't fail entirely because of one thin post.
            const errorCode = error.response?.data?.error?.code;
            if (errorCode === 10) {
                return {};
            }
            logger.error("Instagram media insights request failed", { mediaId, detail: error.response?.data || error.message });
            throw new Error("Instagram media insights request failed");
        }
    }

    /**
     * Flatten Meta's Insights response shape ({ data: [{ name, values: [{value}] }] })
     * into a simple { metricName: value } object.
     * @private
     */
    _parseInsightsResponse(responseData) {
        const result = {};
        for (const metric of responseData.data || []) {
            const latestValue = metric.values?.[metric.values.length - 1]?.value ?? metric.total_value?.value ?? null;
            result[metric.name] = latestValue;
        }
        return result;
    }
}

// Lazily instantiated, same rationale as tomasiApi.service.js: this
// integration is optional and a missing credential shouldn't break
// anything that transitively requires this module but doesn't use it.
let singleton = null;

function getInstance() {
    if (!singleton) {
        singleton = new InstagramService();
    }
    return singleton;
}

module.exports = { getInstance, InstagramService };
