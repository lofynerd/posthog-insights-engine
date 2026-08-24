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

const ADMIN_USER_ID = 6208262978;

jest.mock("../src/config", () => {
    const actual = jest.requireActual("../src/config");
    return {
        ...actual,
        notifications: {
            ...actual.notifications,
            telegram: {
                ...actual.notifications.telegram,
                adminUserId: "6208262978",
            },
        },
    };
});

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

const mockTomasiApiInstance = {
    createInfluencer: jest.fn(),
    listInfluencers: jest.fn(),
    updateInfluencer: jest.fn(),
    disableInfluencer: jest.fn(),
};

jest.mock("../src/services/tomasiApi.service", () => ({
    getInstance: jest.fn(() => mockTomasiApiInstance),
}));

const mockCampaignCollect = jest.fn();
jest.mock("../src/metrics/campaign", () => ({
    collect: (...args) => mockCampaignCollect(...args),
}));

const mockCollectInstagram = jest.fn();
jest.mock("../src/metrics/social", () => ({
    collectInstagram: (...args) => mockCollectInstagram(...args),
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
        // Defaults to the configured admin user so existing tests for
        // commands that are now admin-restricted (/register, /board,
        // /marketing, /pr, /dev) don't all need to opt in individually.
        // Tests specifically covering the restriction itself override
        // this with a different id.
        from: { id: ADMIN_USER_ID },
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
            "influencer",
            "campaign",
            "social",
        ];
        expected.forEach((cmd) => expect(mockCommandHandlers.has(cmd)).toBe(true));
    });

    it("registers a new_chat_members event handler", () => {
        expect(mockEventHandlers.has("new_chat_members")).toBe(true);
    });

    describe("/start and /help", () => {
        it("/start shows the quick command menu", async () => {
            groupRegistry.getGroup.mockResolvedValue(null);
            const ctx = buildCtx({ chat: { id: -600001, type: "supergroup" }, message: { text: "/start" } });
            await mockCommandHandlers.get("start")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining("/latest"),
                expect.any(Object)
            );
        });

        it("/help shows the full walkthrough", async () => {
            groupRegistry.getGroup.mockResolvedValue(null);
            const ctx = buildCtx({ chat: { id: -600002, type: "supergroup" }, message: { text: "/help" } });
            await mockCommandHandlers.get("help")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("Full Walkthrough");
            expect(allReplies).toContain("Health Score");
            // /register and cross-audience viewing are admin-personal
            // now (see requireAdminUser), not a group-level feature --
            // the general walkthrough shouldn't advertise either.
            expect(allReplies).not.toContain("/register");
            expect(allReplies).not.toContain("/board —");
        });

        it("/start omits the influencer section for a non-board group", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Marketing Group", reportType: "marketing" });
            const ctx = buildCtx({ chat: { id: -600006, type: "supergroup" }, message: { text: "/start" } });
            await mockCommandHandlers.get("start")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).not.toContain("/influencer");
            expect(allReplies).not.toContain("/campaign");
        });

        it("/start includes the influencer section for a board group", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            const ctx = buildCtx({ chat: { id: -600007, type: "supergroup" }, message: { text: "/start" } });
            await mockCommandHandlers.get("start")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("/influencer");
            expect(allReplies).toContain("/campaign");
        });

        it("/help omits the influencer section for a non-board group", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Dev Group", reportType: "development" });
            const ctx = buildCtx({ chat: { id: -600008, type: "supergroup" }, message: { text: "/help" } });
            await mockCommandHandlers.get("help")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).not.toContain("/influencer");
            expect(allReplies).not.toContain("ROI needs both platform");
        });

        it("/help includes the influencer section for a board group", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            const ctx = buildCtx({ chat: { id: -600009, type: "supergroup" }, message: { text: "/help" } });
            await mockCommandHandlers.get("help")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("/influencer update");
            expect(allReplies).toContain("ROI needs both platform");
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
            expect(allReplies).toContain("admin");
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
        it("rejects a non-admin caller regardless of the group", async () => {
            const ctx = buildCtx({
                chat: { id: -400000, type: "supergroup" },
                message: { text: "/register board" },
                from: { id: 999999999 },
            });
            await mockCommandHandlers.get("register")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("restricted to a single admin"));
            expect(groupRegistry.registerGroup).not.toHaveBeenCalled();
        });

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

        it("rejects a non-admin caller from viewing another audience's report (e.g. PR trying /board)", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "PR Group", reportType: "pr" });
            const ctx = buildCtx({
                chat: { id: -300006, type: "supergroup" },
                message: { text: "/board" },
                from: { id: 999999999 },
            });

            await mockCommandHandlers.get("board")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("restricted to a single admin"));
            expect(generateGroupReport).not.toHaveBeenCalled();
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

    describe("/influencer (board group only, writes to production)", () => {
        it("rejects non-board groups", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Marketing Group", reportType: "marketing" });
            const ctx = buildCtx({
                chat: { id: -700001, type: "supergroup" },
                message: { text: "/influencer add Jane 15" },
            });

            await mockCommandHandlers.get("influencer")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("restricted to the board"));
            expect(mockTomasiApiInstance.createInfluencer).not.toHaveBeenCalled();
        });

        it("shows usage when no subcommand is given", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            const ctx = buildCtx({
                chat: { id: -700002, type: "supergroup" },
                message: { text: "/influencer" },
            });

            await mockCommandHandlers.get("influencer")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
        });

        describe("add", () => {
            it("shows usage when no discount percentage is present", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                const ctx = buildCtx({
                    chat: { id: -700003, type: "supergroup" },
                    message: { text: "/influencer add Jane Doe" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage: /influencer add"));
                expect(mockTomasiApiInstance.createInfluencer).not.toHaveBeenCalled();
            });

            it("creates an influencer code with name + discount only", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                mockTomasiApiInstance.createInfluencer.mockResolvedValue({
                    name: "Jane Doe",
                    platform: "other",
                    discountPercent: 15,
                    code: "JANEDOE15",
                    slug: "jane-doe",
                    agreedFee: null,
                });
                const ctx = buildCtx({
                    chat: { id: -700004, type: "supergroup" },
                    message: { text: "/influencer add Jane Doe 15" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(mockTomasiApiInstance.createInfluencer).toHaveBeenCalledWith({
                    name: "Jane Doe",
                    discountPercent: 15,
                });
                const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
                expect(allReplies).toContain("JANEDOE15");
                expect(allReplies).toContain("/campaign jane-doe");
                expect(allReplies).toContain("ROI can't be calculated yet");
                expect(allReplies).toContain("/influencer update jane-doe");
                expect(allReplies).toContain("/influencer disable jane-doe");
            });

            it("creates an influencer code with platform and agreed fee", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                mockTomasiApiInstance.createInfluencer.mockResolvedValue({
                    name: "Jane Doe",
                    platform: "instagram",
                    discountPercent: 20,
                    code: "JANEDOE20",
                    slug: "jane-doe",
                    agreedFee: 500,
                });
                const ctx = buildCtx({
                    chat: { id: -700005, type: "supergroup" },
                    message: { text: "/influencer add Jane Doe 20 instagram 500" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(mockTomasiApiInstance.createInfluencer).toHaveBeenCalledWith({
                    name: "Jane Doe",
                    discountPercent: 20,
                    platform: "instagram",
                    agreedFee: 500,
                });
                const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
                expect(allReplies).not.toContain("ROI can't be calculated yet");
            });

            it("surfaces a friendly error when the API call fails", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                mockTomasiApiInstance.createInfluencer.mockRejectedValue(new Error("Code already exists"));
                const ctx = buildCtx({
                    chat: { id: -700006, type: "supergroup" },
                    message: { text: "/influencer add Jane 15" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Code already exists"));
            });
        });

        describe("list", () => {
            it("shows a message when there are no influencers yet", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                mockTomasiApiInstance.listInfluencers.mockResolvedValue([]);
                const ctx = buildCtx({
                    chat: { id: -700007, type: "supergroup" },
                    message: { text: "/influencer list" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("No influencer codes"));
            });

            it("lists existing influencers with status indicators", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                mockTomasiApiInstance.listInfluencers.mockResolvedValue([
                    { name: "Jane", code: "JANE10", discountPercent: 10, platform: "instagram", status: "active" },
                    { name: "Bob", code: "BOB20", discountPercent: 20, platform: "tiktok", status: "disabled" },
                ]);
                const ctx = buildCtx({
                    chat: { id: -700008, type: "supergroup" },
                    message: { text: "/influencer list" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
                expect(allReplies).toContain("JANE10");
                expect(allReplies).toContain("BOB20");
                expect(allReplies).toContain("🟢");
                expect(allReplies).toContain("⚪");
            });
        });

        describe("update", () => {
            it("shows usage when no slug is given", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                const ctx = buildCtx({
                    chat: { id: -701001, type: "supergroup" },
                    message: { text: "/influencer update" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage: /influencer update"));
                expect(mockTomasiApiInstance.updateInfluencer).not.toHaveBeenCalled();
            });

            it("updates both platform and agreedFee", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                mockTomasiApiInstance.updateInfluencer.mockResolvedValue({
                    name: "Jane Doe",
                    slug: "jane-doe",
                    platform: "instagram",
                    agreedFee: 500,
                });
                const ctx = buildCtx({
                    chat: { id: -701002, type: "supergroup" },
                    message: { text: "/influencer update jane-doe instagram 500" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(mockTomasiApiInstance.updateInfluencer).toHaveBeenCalledWith("jane-doe", {
                    platform: "instagram",
                    agreedFee: 500,
                });
                const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
                expect(allReplies).toContain("ROI can now be calculated");
                expect(allReplies).toContain("/campaign jane-doe");
            });

            it("updates only agreedFee when platform is skipped with -", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                mockTomasiApiInstance.updateInfluencer.mockResolvedValue({
                    name: "Jane Doe",
                    slug: "jane-doe",
                    platform: "other",
                    agreedFee: 300,
                });
                const ctx = buildCtx({
                    chat: { id: -701003, type: "supergroup" },
                    message: { text: "/influencer update jane-doe - 300" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(mockTomasiApiInstance.updateInfluencer).toHaveBeenCalledWith("jane-doe", {
                    agreedFee: 300,
                });
                const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
                expect(allReplies).toContain("ROI still can't be calculated");
                expect(allReplies).toContain("platform");
            });

            it("surfaces a friendly error when the API call fails", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                mockTomasiApiInstance.updateInfluencer.mockRejectedValue(new Error("Influencer not found"));
                const ctx = buildCtx({
                    chat: { id: -701004, type: "supergroup" },
                    message: { text: "/influencer update unknown-slug instagram 500" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Influencer not found"));
            });
        });

        describe("disable", () => {
            it("shows usage when no slug is given", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                const ctx = buildCtx({
                    chat: { id: -700009, type: "supergroup" },
                    message: { text: "/influencer disable" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage: /influencer disable"));
                expect(mockTomasiApiInstance.disableInfluencer).not.toHaveBeenCalled();
            });

            it("disables the given slug", async () => {
                groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
                mockTomasiApiInstance.disableInfluencer.mockResolvedValue({ message: "Disabled Jane's code." });
                const ctx = buildCtx({
                    chat: { id: -700010, type: "supergroup" },
                    message: { text: "/influencer disable jane-doe" },
                });

                await mockCommandHandlers.get("influencer")(ctx);

                expect(mockTomasiApiInstance.disableInfluencer).toHaveBeenCalledWith("jane-doe");
                expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Disabled Jane's code."));
            });
        });
    });

    describe("/campaign", () => {
        it("shows usage when no slug is given", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            const ctx = buildCtx({
                chat: { id: -800001, type: "supergroup" },
                message: { text: "/campaign" },
            });

            await mockCommandHandlers.get("campaign")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Usage: /campaign"));
        });

        it("reports when the slug doesn't match any known influencer", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            mockTomasiApiInstance.listInfluencers.mockResolvedValue([{ slug: "jane-doe" }]);
            const ctx = buildCtx({
                chat: { id: -800002, type: "supergroup" },
                message: { text: "/campaign unknown-slug" },
            });

            await mockCommandHandlers.get("campaign")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("No influencer found"));
            expect(mockCampaignCollect).not.toHaveBeenCalled();
        });

        it("shows the full breakdown (cost, orders, units, revenue, ROI) for a known campaign", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            mockTomasiApiInstance.listInfluencers.mockResolvedValue([
                { name: "Jane Doe", platform: "instagram", slug: "jane-doe", code: "JANEDOE15", agreedFee: 200 },
            ]);
            mockCampaignCollect.mockResolvedValue({
                campaign: { slug: "jane-doe", periodDays: null },
                influencer: { name: "Jane Doe", platform: "instagram" },
                code: "JANEDOE15",
                cost: 200,
                orders: 5,
                unitsSold: 7,
                revenue: 500,
                conversionRate: 0.05,
                roiPercent: 150,
                profit: 300,
                reach: 100,
                pageviews: 120,
            });
            const ctx = buildCtx({
                chat: { id: -800003, type: "supergroup" },
                message: { text: "/campaign jane-doe" },
            });

            await mockCommandHandlers.get("campaign")(ctx);

            expect(mockCampaignCollect).toHaveBeenCalledWith(
                expect.objectContaining({ slug: "jane-doe" }),
                null
            );
            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("Jane Doe");
            expect(allReplies).toContain("100");
            expect(allReplies).toContain("Units sold");
            expect(allReplies).toContain("7");
            expect(allReplies).toContain("Campaign cost");
            expect(allReplies).toContain("200");
            expect(allReplies).toContain("ROI: 150%");
        });

        it("shows N/A (never a misleading number) for cost and ROI when no fee is set", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            mockTomasiApiInstance.listInfluencers.mockResolvedValue([
                { name: "Jane Doe", platform: "instagram", slug: "jane-doe", code: "JANEDOE15", agreedFee: null },
            ]);
            mockCampaignCollect.mockResolvedValue({
                campaign: { slug: "jane-doe", periodDays: null },
                influencer: { name: "Jane Doe", platform: "instagram" },
                code: "JANEDOE15",
                cost: null,
                orders: 5,
                unitsSold: 6,
                revenue: 500,
                conversionRate: 0.05,
                roiPercent: null,
                profit: null,
                reach: 100,
                pageviews: 110,
            });
            const ctx = buildCtx({
                chat: { id: -800004, type: "supergroup" },
                message: { text: "/campaign jane-doe" },
            });

            await mockCommandHandlers.get("campaign")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("ROI: N/A");
            expect(allReplies).toContain("N/A (not set)");
            expect(allReplies).not.toContain("ROI: null");
            expect(allReplies).not.toContain("Infinity");
        });

        it("shows N/A for ROI when cost is explicitly 0", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            mockTomasiApiInstance.listInfluencers.mockResolvedValue([
                { name: "Jane Doe", platform: "instagram", slug: "jane-doe", code: "JANEDOE15", agreedFee: 0 },
            ]);
            mockCampaignCollect.mockResolvedValue({
                campaign: { slug: "jane-doe", periodDays: null },
                influencer: { name: "Jane Doe", platform: "instagram" },
                code: "JANEDOE15",
                cost: null,
                orders: 2,
                unitsSold: 2,
                revenue: 100,
                conversionRate: 0.02,
                roiPercent: null,
                profit: null,
                reach: 100,
                pageviews: 100,
            });
            const ctx = buildCtx({
                chat: { id: -800006, type: "supergroup" },
                message: { text: "/campaign jane-doe" },
            });

            await mockCommandHandlers.get("campaign")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("ROI: N/A");
        });

        it("respects an explicit [days] argument", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            mockTomasiApiInstance.listInfluencers.mockResolvedValue([
                { name: "Jane Doe", platform: "instagram", slug: "jane-doe", code: "JANEDOE15", agreedFee: null },
            ]);
            mockCampaignCollect.mockResolvedValue({
                campaign: { slug: "jane-doe", periodDays: 30 },
                influencer: { name: "Jane Doe", platform: "instagram" },
                code: "JANEDOE15",
                cost: null,
                orders: 1,
                unitsSold: 1,
                revenue: 100,
                conversionRate: 0.1,
                roiPercent: null,
                profit: null,
                reach: 10,
                pageviews: 10,
            });
            const ctx = buildCtx({
                chat: { id: -800005, type: "supergroup" },
                message: { text: "/campaign jane-doe 30" },
            });

            await mockCommandHandlers.get("campaign")(ctx);

            expect(mockCampaignCollect).toHaveBeenCalledWith(expect.any(Object), 30);
        });
    });

    describe("/social", () => {
        it("defaults to 30 days and reports account metrics + top post", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            mockCollectInstagram.mockResolvedValue({
                reach: 1000,
                accountsEngaged: 50,
                followerCount: 500,
                topPost: {
                    caption: "Our CEO on brand values",
                    likes: 200,
                    comments: 15,
                    saved: 30,
                    reach: 800,
                    permalink: "https://instagram.com/p/xyz",
                },
            });
            const ctx = buildCtx({ chat: { id: -900002, type: "supergroup" }, message: { text: "/social" } });

            await mockCommandHandlers.get("social")(ctx);

            expect(mockCollectInstagram).toHaveBeenCalledWith(30, 10);
            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("1000");
            expect(allReplies).toContain("CEO on brand values");
            expect(allReplies).toContain("instagram.com/p/xyz");
        });

        it("respects an explicit [days] argument", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            mockCollectInstagram.mockResolvedValue({ reach: 10, accountsEngaged: 1, followerCount: 5, topPost: null });
            const ctx = buildCtx({ chat: { id: -900003, type: "supergroup" }, message: { text: "/social 7" } });

            await mockCommandHandlers.get("social")(ctx);

            expect(mockCollectInstagram).toHaveBeenCalledWith(7, 10);
        });

        it("shows a message when there are no recent posts", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            mockCollectInstagram.mockResolvedValue({ reach: 10, accountsEngaged: 1, followerCount: 5, topPost: null });
            const ctx = buildCtx({ chat: { id: -900004, type: "supergroup" }, message: { text: "/social" } });

            await mockCommandHandlers.get("social")(ctx);

            const allReplies = ctx.reply.mock.calls.map((call) => call[0]).join("\n");
            expect(allReplies).toContain("No recent posts found.");
        });

        it("surfaces a friendly error when the Instagram API call fails", async () => {
            groupRegistry.getGroup.mockResolvedValue({ groupName: "Board Group", reportType: "board" });
            mockCollectInstagram.mockRejectedValue(new Error("Instagram account insights request failed"));
            const ctx = buildCtx({ chat: { id: -900005, type: "supergroup" }, message: { text: "/social" } });

            await mockCommandHandlers.get("social")(ctx);

            expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Instagram account insights request failed"));
        });
    });
});
