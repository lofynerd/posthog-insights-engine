const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

// Only queries defined in src/queries are trusted. This guards against
// accidentally passing unsanitized user input into HogQL if a future
// caller wires request data through this service.
const HOGQL_QUERY_PATTERN = /^[\s\S]{1,10000}$/;

// Caps prevent a misbehaving/compromised upstream from forcing this
// process to buffer unbounded response bodies in memory.
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB
const REQUEST_TIMEOUT_MS = 15_000;

class PostHogService {
    constructor(posthogConfig = config.posthog) {
        this.config = posthogConfig;

        if (!this.config.apiKey || !this.config.projectId) {
            throw new Error(
                "PostHogService requires apiKey and projectId to be configured"
            );
        }

        this.client = axios.create({
            baseURL: `${this.config.host}/api/projects/${encodeURIComponent(
                this.config.projectId
            )}`,
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                "Content-Type": "application/json",
            },
            timeout: REQUEST_TIMEOUT_MS,
            maxContentLength: MAX_RESPONSE_BYTES,
            maxBodyLength: MAX_RESPONSE_BYTES,
            // Never follow redirects on an authenticated request: a
            // malicious or misconfigured redirect could leak the
            // Authorization header to an unintended host.
            maxRedirects: 0,
        });
    }

    /**
     * Execute a HogQL query against the configured PostHog project.
     *
     * @param {string} query HogQL query text. Must originate from
     *   src/queries (trusted, static definitions) — never build this
     *   string from unsanitized user input.
     * @returns {Promise<object>} PostHog query response.
     */
    async runHogQL(query) {
        if (typeof query !== "string" || !HOGQL_QUERY_PATTERN.test(query)) {
            throw new Error("Invalid HogQL query: must be a non-empty string under 10KB");
        }

        try {
            const response = await this.client.post("/query", {
                query: {
                    kind: "HogQLQuery",
                    query,
                },
            });

            if (!response.data || !Array.isArray(response.data.results)) {
                throw new Error("Unexpected PostHog response shape");
            }

            return response.data;
        } catch (error) {
            logger.error(
                "PostHog query failed",
                error.response?.data || error.message
            );
            throw new Error("PostHog query failed");
        }
    }
}

module.exports = new PostHogService();
module.exports.PostHogService = PostHogService;
