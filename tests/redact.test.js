const { redact, redactString, maskValue } = require("../src/utils/redact");

describe("redact utility", () => {
    it("masks known secret shapes inside strings", () => {
        const input = "Authorization: Bearer phx_REDACTEDPLACEHOLDER";
        expect(redactString(input)).not.toContain("abcdefghijklmno1234567890");
        expect(redactString(input)).toMatch(/Bearer \*\*\*|Bear\.\.\./);
    });

    it("masks PostHog personal API keys", () => {
        const input = "key=REDACTED-POSTHOG-KEY";
        const output = redactString(input);
        expect(output).not.toContain("REDACTED");
    });

    it("masks Telegram bot tokens (id:secret shape)", () => {
        const input = "token REDACTED-TELEGRAM-TOKEN in url";
        const output = redactString(input);
        expect(output).not.toContain("REDACTED");
    });

    it("fully masks values under sensitive key names in objects", () => {
        const output = redact({ apiKey: "supersecretvalue1234", other: "fine" });
        expect(output.apiKey).not.toBe("supersecretvalue1234");
        expect(output.other).toBe("fine");
    });

    it("redacts nested objects and arrays", () => {
        const output = redact({
            config: { token: "abcdefghijklmnop" },
            list: [{ secret: "zzzzzzzzzzzz" }],
        });
        expect(output.config.token).not.toContain("abcdefghijklmnop");
        expect(output.list[0].secret).not.toContain("zzzzzzzzzzzz");
    });

    it("handles circular references without throwing", () => {
        const obj = { name: "test" };
        obj.self = obj;
        expect(() => redact(obj)).not.toThrow();
    });

    it("extracts only the message from Error instances", () => {
        const err = new Error("boom phx_REDACTED");
        const output = redact(err);
        expect(output).not.toContain("REDACTED");
    });

    it("maskValue shortens long secrets to a fixed preview", () => {
        const masked = maskValue("abcdefghijklmnopqrstuvwxyz");
        expect(masked).toBe("abcd...wxyz");
    });

    it("maskValue fully masks short values", () => {
        expect(maskValue("short")).toBe("***");
    });
});
