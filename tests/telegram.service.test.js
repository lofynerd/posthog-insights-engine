jest.mock("axios", () => ({
    create: jest.fn(),
}));

jest.mock("../src/utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const axios = require("axios");
const { TelegramService } = require("../src/notifications/telegram.service");

describe("TelegramService", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    function buildService(post = jest.fn().mockResolvedValue({ data: { ok: true } })) {
        axios.create.mockReturnValue({ post });
        const service = new TelegramService({
            botToken: "123:abc",
            chatId: "-100123456",
        });
        return { service, post };
    }

    it("throws if constructed without a bot token", () => {
        expect(() => new TelegramService({ botToken: "", chatId: "1" })).toThrow(
            /TELEGRAM_BOT_TOKEN/
        );
    });

    it("rejects a non-numeric chat id", async () => {
        const { service } = buildService();
        await expect(service.sendMessage("hello", "not-a-number")).rejects.toThrow(
            /must be numeric/
        );
    });

    it("rejects empty messages", async () => {
        const { service } = buildService();
        await expect(service.sendMessage("")).rejects.toThrow(/non-empty string/);
    });

    it("truncates oversized messages instead of sending unbounded content", async () => {
        const { service, post } = buildService();
        const huge = "x".repeat(30_000);

        await service.sendMessage(huge);

        const allSentText = post.mock.calls.map((call) => call[1].text).join("");
        expect(allSentText.length).toBeLessThan(30_000);
        expect(allSentText).toContain("[truncated: report exceeded size limit]");
    });

    it("falls back to plain text when Markdown parsing fails", async () => {
        const post = jest
            .fn()
            .mockRejectedValueOnce({
                response: { data: { description: "Bad Request: can't parse entities" } },
            })
            .mockResolvedValueOnce({ data: { ok: true } });

        const { service } = buildService(post);
        const result = await service.sendMessage("*broken markdown");

        expect(post).toHaveBeenCalledTimes(2);
        expect(result[0]).toEqual({ ok: true });
    });

    it("sends normally when everything succeeds", async () => {
        const { service, post } = buildService();
        await service.sendMessage("hello group");

        expect(post).toHaveBeenCalledWith(
            "/sendMessage",
            expect.objectContaining({ chat_id: "-100123456" })
        );
    });
});
