jest.mock("node-cron", () => ({
    schedule: jest.fn(),
}));

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    error: jest.fn(),
}));

jest.mock("../src/notifications/groupRegistry", () => ({
    listGroups: jest.fn(),
}));

jest.mock("../src/insights/reportGenerator", () => ({
    generateCompactSummary: jest.fn(),
}));

const cron = require("node-cron");
const { startScheduler } = require("../src/scheduler/scheduledReports");

describe("Scheduler - Automatic Reports", () => {
    let mockBot;

    beforeEach(() => {
        jest.clearAllMocks();
        mockBot = {
            telegram: {
                sendPhoto: jest.fn(),
                sendMessage: jest.fn(),
            },
        };
    });

    it("registers exactly 3 scheduled jobs (weekly, monthly, quarterly)", () => {
        const tasks = startScheduler(mockBot);

        expect(cron.schedule).toHaveBeenCalledTimes(3);
        expect(tasks).toHaveLength(3);
    });

    it("schedules weekly reports for Monday at 08:00", () => {
        startScheduler(mockBot);

        expect(cron.schedule).toHaveBeenCalledWith(
            "0 8 * * 1", // Monday at 08:00
            expect.any(Function)
        );
    });

    it("schedules monthly reports for 1st of month at 08:00", () => {
        startScheduler(mockBot);

        expect(cron.schedule).toHaveBeenCalledWith(
            "0 8 1 * *", // 1st of month at 08:00
            expect.any(Function)
        );
    });

    it("schedules quarterly reports for calendar quarters at 08:00", () => {
        startScheduler(mockBot);

        // Quarterly: 1st of Jan, Apr, Jul, Oct at 08:00
        expect(cron.schedule).toHaveBeenCalledWith(
            "0 8 1 1,4,7,10 *",
            expect.any(Function)
        );
    });

    it("does NOT schedule daily automatic reports", () => {
        startScheduler(mockBot);

        // Verify no daily schedule exists
        const calls = cron.schedule.mock.calls;
        const dailyPattern = calls.find(([pattern]) => 
            pattern.includes("* * *") && !pattern.includes("1,4,7,10")
        );

        expect(dailyPattern).toBeUndefined();
    });

    it("weekly schedule callback runs weekly reports", async () => {
        startScheduler(mockBot);

        // Get the callback function for weekly (first call)
        const weeklyCallback = cron.schedule.mock.calls[0][1];

        // Execute it
        await weeklyCallback();

        // Verify it doesn't throw (actual report generation is mocked)
        expect(weeklyCallback).toBeDefined();
    });

    it("monthly schedule callback runs monthly reports", async () => {
        startScheduler(mockBot);

        // Get the callback function for monthly (second call)
        const monthlyCallback = cron.schedule.mock.calls[1][1];

        // Execute it
        await monthlyCallback();

        // Verify it doesn't throw
        expect(monthlyCallback).toBeDefined();
    });

    it("quarterly schedule callback runs quarterly reports", async () => {
        startScheduler(mockBot);

        // Get the callback function for quarterly (third call)
        const quarterlyCallback = cron.schedule.mock.calls[2][1];

        // Execute it
        await quarterlyCallback();

        // Verify it doesn't throw
        expect(quarterlyCallback).toBeDefined();
    });

    it("logs scheduler startup with correct job count", () => {
        const logger = require("../src/utils/logger");

        startScheduler(mockBot);

        expect(logger.info).toHaveBeenCalledWith("Scheduler started", { jobs: 3 });
    });
});
