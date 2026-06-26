const posthog = require("../services/posthog.service");
const queries = require("../queries/discoverEvents.queries");
const logger = require("../utils/logger");

(async () => {
    try {
        const result = await posthog.runHogQL(
            queries.latestPageview
        );

        logger.info(
            JSON.stringify(result, null, 2)
        );
    } catch (err) {
        logger.error(err.message);
    }
})();
