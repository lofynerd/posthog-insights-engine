const posthog = require("../services/posthog.service");
const queries = require("../queries/acquisition.queries");
const logger = require("../utils/logger");

async function getUniqueUsers() {
    try {
        const response = await posthog.runHogQL(
            queries.uniqueVisitors
        );

        logger.info(JSON.stringify(response, null, 2));
    } catch(err) {
        logger.error(err.message);
    }
}

getUniqueUsers();
