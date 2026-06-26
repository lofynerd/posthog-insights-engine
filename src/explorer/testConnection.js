const axios = require("axios");
const config = require("../config");
const logger = require("../utils/logger");

async function testConnection() {
    try {
        const response = await axios.get(
            `${config.posthog.host}/api/projects/${config.posthog.projectId}`,
            {
                headers: {
                    Authorization: `Bearer ${config.posthog.apiKey}`
                }
            }
        );

        logger.info(response.data);
    } catch (error) {
        logger.error(error.response?.data || error.message);
    }
}

testConnection();
