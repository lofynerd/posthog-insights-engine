require("dotenv").config();

const axios = require("axios");

class PostHogService {
    constructor() {
        this.client = axios.create({
            baseURL: `https://us.posthog.com/api/projects/${process.env.POSTHOG_PROJECT_ID}`,
            headers: {
                Authorization: `Bearer ${process.env.POSTHOG_API_KEY}`,
                "Content-Type": "application/json",
            },
        });
    }

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
            console.error(
                "PostHog Query Failed:",
                error.response?.data || error.message
            );
            throw error;
        }
    }
}

module.exports = new PostHogService();