const posthog = require("../services/posthog.service");
const queries = require("../queries/discoverEvents.queries");

(async () => {
    try {
        const result = await posthog.runHogQL(
            queries.latestPageview
        );

        console.log(
            JSON.stringify(result, null, 2)
        );
    } catch (err) {
        console.error(err);
    }
})();