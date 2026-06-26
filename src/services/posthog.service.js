const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

class PostHogService {
    constructor(posthogConfig = config.posthog) {
        this.config = posthogConfig;
        this.client = axios.create({
            baseURL: `${this.config.host}/api/projects/${this.config.projectId}`,
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                "Content-Type": "application/json",
            },
        });
    }

    /**
     * Execute a HogQL query against the configured PostHog project.
     *
     * @param {string} query HogQL query text.
     * @returns {Promise<object>} PostHog query response.
     */
    async runHogQL(query) {
        try {
            const response = await this.client.post("/query", {
                query: {
                    kind: "HogQLQuery",
                    query,
                },
            });

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
