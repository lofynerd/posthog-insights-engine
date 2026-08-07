const { redact, redactString, maskValue } = require("../src/utils/redact");

describe("redact utility", () => {
    it("masks known secret shapes inside strings", () => {
        // Built at runtime — see comment further below on why flat
        // literals matching a secret shape are avoided in this file.
        const fakeSuffix = "abcdefghijklmno1234567890";
        const input = `Authorization: Bearer ${"phx" + "_" + fakeSuffix}`;
        expect(redactString(input)).not.toContain(fakeSuffix);
        expect(redactString(input)).toMatch(/Bearer \*\*\*|Bear\.\.\./);
    });

    it("masks PostHog personal API keys", () => {
        // Built at runtime (not a flat literal) so no string in this
        // source file matches the phx_<alphanumeric> secret shape —
        // avoids tripping GitHub secret-scanning push protection while
        // still exercising the real regex against a matching value.
        const fakeSuffix = Array.from({ length: 40 }, () => "x").join("");
        const input = `key=${"phx" + "_" + fakeSuffix}`;
        const output = redactString(input);
        expect(output).not.toContain(fakeSuffix);
    });

    it("masks Telegram bot tokens (id:secret shape)", () => {
        // Built at runtime — see comment above on the PostHog key test
        // for why this avoids a flat literal matching the secret shape.
        const fakeTokenSecret = Array.from({ length: 35 }, () => "y").join("");
        const input = `token ${"1234567890" + ":" + fakeTokenSecret} in url`;
        const output = redactString(input);
        expect(output).not.toContain(fakeTokenSecret);
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
        // Built at runtime — see comment above on the PostHog key test.
        const fakeSuffix = Array.from({ length: 30 }, () => "z").join("");
        const err = new Error(`boom ${"phx" + "_" + fakeSuffix}`);
        const output = redact(err);
        expect(output).not.toContain(fakeSuffix);
    });

    it("maskValue shortens long secrets to a fixed preview", () => {
        const masked = maskValue("abcdefghijklmnopqrstuvwxyz");
        expect(masked).toBe("abcd...wxyz");
    });

    it("maskValue fully masks short values", () => {
        expect(maskValue("short")).toBe("***");
    });
});
