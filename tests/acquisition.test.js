jest.mock("../src/services/posthog.service", () => ({
    runHogQL: jest.fn(),
}));

const posthog = require("../src/services/posthog.service");
const queries = require("../src/queries/acquisition.queries");
const acquisition = require("../src/metrics/acquisition");

describe("acquisition metrics", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("returns unique visitor count from PostHog results", async () => {
        posthog.runHogQL.mockResolvedValue({
            results: [[42]],
        });

        await expect(acquisition.getUniqueVisitors()).resolves.toBe(42);
        expect(posthog.runHogQL).toHaveBeenCalledWith(queries.uniqueVisitors);
    });
});
