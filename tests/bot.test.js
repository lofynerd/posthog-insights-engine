const mockCommandHandlers = new Map();
const mockEventHandlers = new Map();

jest.mock("telegraf", () => {
    class MockTelegraf {
        constructor(token) {
            this.token = token;
            this.use = jest.fn();
            this.catch = jest.fn();
            this.launch = jest.fn();
            this.stop = jest.fn();
            this.botInfo = { id: 999 };
        }

        command(name, handler) {
            mockCommandHandlers.set(name, handler);
        }

        on(event, handler) {
            mockEventHandlers.set(event, handler);
        }
    }
    return { Telegraf: MockTelegraf };
});

jest.mock("../src/notifications/groupRegistry", () => ({
    getGroup: jest.fn(),
    registerGroup: jest.fn(),
}));

jest.mock("../src/insights/reportGenerator", () => ({
    generateGroupReport: jest.fn(),
}));

jest.mock("../src/ai/analysis.service", () => ({
    classify: jest.fn(),
    answerQuestion: jest.fn(),
}));

jest.mock("../src/ai/relevanceGuard", () => ({
    isRelevant: jest.fn(),
    heuristicReject: jest.fn(),
    MAX_QUESTION_LENGTH: 500,
}));

jest.mock("../src/insights/collector", () => ({
    collectAll: jest.fn(),
}));

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const groupRegistry = require("../src/notifications/groupRegistry");
const { generateGroupReport } = require("../src/insights/reportGenerator");
const analysisService = require("../src/ai/analysis.service");
const { isRelevant, heuristicReject } = require("../src/ai/relevanceGuard");
const { collectAll } = require("../src/insights/collector");
const { createBot } = require("../src/notifications/bot");

function buildCtx(overrides = {}) {
    return {
        chat: { id: -100123, type: "supergroup", title: "Test Group" },
        message: { text: "/latest" },
        reply: jest.fn().mockResolvedValue(undefined),
        botInfo: { id: 999 },
        ...overrides,
    };
}

describe("Telegram bot commands", () => {
    let bot;

    beforeEach(() => {
        mockCommandHandlers.clear();
        jest.clearAllMocks();
        bot = createBot("123:test-token");
    });

    afterEach(() => {
        // Prevent the rate limiter sweep interval from keeping the
        // Jest process alive after the test file finishes.
        clearInterval(bot?._rateLimiterSweepInterval);
    });

    it("throws if created without a bot token", () => {
        expect(() => createBot("")).toThrow(/TELEGRAM_BOT_TOKEN/);
    });

    it("registers all expected commands", () => {
        const expected = [
            "start",
            "help",
            "register",
            "latest",
            "weekly",
            "monthly",
            "quarterly",
            "board",
            "marketing",
            "pr",
            "dev",
            "details",
            "recommend",
            "funnel",
            "ask",
            "test",
        ];
        expected.forEach((cmd) => expect(mockCommandHandlers.has(cmd)).toBe(true));
    });

    it("registers a new_chat_members event handler", () => {
        expect(mockEventHandlers.has("new_chat_members")).toBe(true);
    });

    describe("/start and /help", () => {
        it("/start shows the quick command menu", async () => {
            const ctx = buildCtx({ chat: { id: -600001, type: "supergroup" }, message: { text: "/start" } });
            await mockCommandHandlers.get("start")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining("/register"),
                expect.any(Object)
            );
        });

        it("/help shows the full walkthrough", async () => {
            const ctx = buildCtx({ chat: { id: -600002, type: "supergroup" }, message: { text: "/help" } });
            await mockCommandHandlers.get("help")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("Full Walkthrough");
            expect(allReplies).toContain("/register");
            expect(allReplies).toContain("Health Score");
        });
    });

    describe("new_chat_members", () => {
        it("shows the registration prompt when the bot itself is added to an unregistered group", async () => {
            groupRegistry.getGroup.mockResolvedValue(null);
            const ctx = buildCtx({
                chat: { id: -600003, type: "supergroup" },
                message: { new_chat_members: [{ id: 999, is_bot: true }] },
            });

            await mockEventHandlers.get("new_chat_members")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("just joined");
            expect(allReplies).toContain("/register");
        });

        it("shows the quick menu when a regular member joins a registered group", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            const ctx = buildCtx({
                chat: { id: -600004, type: "supergroup" },
                message: { new_chat_members: [{ id: 42, is_bot: false }] },
            });

            await mockEventHandlers.get("new_chat_members")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("/latest");
            expect(allReplies).not.toContain("just joined");
        });

        it("shows the quick menu when the bot joins an already-registered group", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            const ctx = buildCtx({
                chat: { id: -600005, type: "supergroup" },
                message: { new_chat_members: [{ id: 999, is_bot: true }] },
            });

            await mockEventHandlers.get("new_chat_members")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).not.toContain("just joined");
            expect(allReplies).toContain("/latest");
        });
    });

    describe("/register", () => {
        it("rejects an invalid report type", async () => {
            const ctx = buildCtx({ chat: { id: -400001, type: "supergroup" }, message: { text: "/register nonsense" } });
            await mockCommandHandlers.get("register")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
            expect(groupRegistry.registerGroup).not.toHaveBeenCalled();
        });

        it("accepts a legacy alias and normalizes it before registering", async () => {
            const ctx = buildCtx({
                chat: { id: -400002, type: "supergroup" },
                message: { text: "/register founder My Group" },
            });
            groupRegistry.registerGroup.mockResolvedValue({});

            await mockCommandHandlers.get("register")(ctx);

            expect(groupRegistry.registerGroup).toHaveBeenCalledWith(-400002, "My Group", "board");
        });

        it("registers a canonical type directly", async () => {
            const ctx = buildCtx({
                chat: { id: -400003, type: "supergroup", title: "Test Group" },
                message: { text: "/register marketing" },
            });
            groupRegistry.registerGroup.mockResolvedValue({});

            await mockCommandHandlers.get("register")(ctx);

            expect(groupRegistry.registerGroup).toHaveBeenCalledWith(-400003, "Test Group", "marketing");
        });
    });

    describe("period report commands", () => {
        // Distinct chat ids per test: the report rate limiter is a
        // module-level singleton shared across createBot() calls.
        it("prompts registration when the group isn't registered", async () => {
            groupRegistry.getGroup.mockResolvedValue(null);
            const ctx = buildCtx({ chat: { id: -300001, type: "supergroup" } });

            await mockCommandHandlers.get("latest")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("isn't registered"));
            expect(generateGroupReport).not.toHaveBeenCalled();
        });

        it("generates and sends a report for a registered group", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            generateGroupReport.mockResolvedValue({ reportText: "Report body" });
            const ctx = buildCtx({ chat: { id: -300002, type: "supergroup" } });

            await mockCommandHandlers.get("latest")(ctx);

            expect(generateGroupReport).toHaveBeenCalledWith("Founder Group", "board", "latest");
            expect(ctx.reply).toHaveBeenCalledWith("Report body", expect.objectContaining({ parse_mode: "Markdown" }));
        });

        it("/board overrides the report type but keeps the group's own scope", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Marketing Group", reportType: "marketing" });
            generateGroupReport.mockResolvedValue({ reportText: "Board view" });
            const ctx = buildCtx({ chat: { id: -300003, type: "supergroup" }, message: { text: "/board" } });

            await mockCommandHandlers.get("board")(ctx);

            expect(generateGroupReport).toHaveBeenCalledWith("Marketing Group", "board", "weekly");
        });

        it("/dev requests the development report type", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "PR Group", reportType: "pr" });
            generateGroupReport.mockResolvedValue({ reportText: "Dev view" });
            const ctx = buildCtx({ chat: { id: -300004, type: "supergroup" }, message: { text: "/dev" } });

            await mockCommandHandlers.get("dev")(ctx);

            expect(generateGroupReport).toHaveBeenCalledWith("PR Group", "development", "weekly");
        });

        it("replies with a friendly error if report generation fails", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            generateGroupReport.mockRejectedValue(new Error("boom"));
            const ctx = buildCtx({ chat: { id: -300005, type: "supergroup" } });

            await mockCommandHandlers.get("latest")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Couldn't generate"));
        });
    });

    describe("/details, /recommend, /funnel", () => {
        // Each test uses a distinct chat id: the ask/expansion rate
        // limiter is a module-level singleton shared across
        // createBot() calls, so reusing one chat id across many tests
        // in this file would trip the limit from unrelated tests.
        it("/details requests an expanded report using the last-known scope", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            generateGroupReport.mockResolvedValue({ reportText: "Expanded report" });
            const ctx = buildCtx({ chat: { id: -200001, type: "supergroup" }, message: { text: "/details" } });

            await mockCommandHandlers.get("details")(ctx);

            expect(generateGroupReport).toHaveBeenCalledWith(
                "Founder Group",
                "board",
                "weekly",
                { expanded: true }
            );
        });

        it("/recommend asks a targeted recommendations question", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            collectAll.mockResolvedValue({ acquisition: {} });
            analysisService.answerQuestion.mockResolvedValue("Do X, Y, Z");
            const ctx = buildCtx({ chat: { id: -200002, type: "supergroup" }, message: { text: "/recommend" } });

            await mockCommandHandlers.get("recommend")(ctx);

            expect(analysisService.answerQuestion).toHaveBeenCalledWith(
                expect.stringContaining("recommendations"),
                { acquisition: {} },
                expect.any(String)
            );
        });

        it("/funnel asks a targeted funnel breakdown question", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            collectAll.mockResolvedValue({ acquisition: {} });
            analysisService.answerQuestion.mockResolvedValue("Funnel breakdown");
            const ctx = buildCtx({ chat: { id: -200003, type: "supergroup" }, message: { text: "/funnel" } });

            await mockCommandHandlers.get("funnel")(ctx);

            expect(analysisService.answerQuestion).toHaveBeenCalledWith(
                expect.stringContaining("funnel"),
                { acquisition: {} },
                expect.any(String)
            );
        });
    });

    describe("/ask", () => {
        it("rejects off-topic questions via the heuristic guard without calling AI", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            heuristicReject.mockReturnValue(true);
            const ctx = buildCtx({
                chat: { id: -200004, type: "supergroup" },
                message: { text: "/ask write me a poem" },
            });

            await mockCommandHandlers.get("ask")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("off-topic"));
            expect(isRelevant).not.toHaveBeenCalled();
        });

        it("rejects when the AI relevance check fails", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            heuristicReject.mockReturnValue(false);
            isRelevant.mockResolvedValue(false);
            const ctx = buildCtx({
                chat: { id: -200005, type: "supergroup" },
                message: { text: "/ask what is the capital of France" },
            });

            await mockCommandHandlers.get("ask")(ctx);

            expect(analysisService.answerQuestion).not.toHaveBeenCalled();
        });

        it("answers a relevant question", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            heuristicReject.mockReturnValue(false);
            isRelevant.mockResolvedValue(true);
            collectAll.mockResolvedValue({ acquisition: {} });
            analysisService.answerQuestion.mockResolvedValue("42 visitors this week.");
            const ctx = buildCtx({
                chat: { id: -200006, type: "supergroup" },
                message: { text: "/ask how many visitors this week?" },
            });

            await mockCommandHandlers.get("ask")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(
                "42 visitors this week.",
                expect.objectContaining({ parse_mode: "Markdown" })
            );
        });
    });

    describe("/test", () => {
        it("reports registration, PostHog, and AI status", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Founder Group", reportType: "board" });
            collectAll.mockResolvedValue({ acquisition: { pageviews: 10 } });
            analysisService.classify.mockResolvedValue("OK");
            const ctx = buildCtx({ chat: { id: -500001, type: "supergroup" }, message: { text: "/test" } });

            await mockCommandHandlers.get("test")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("Registered as *board*");
            expect(allReplies).toContain("PostHog reachable");
            expect(allReplies).toContain("AI reachable");
        });
    });
});
