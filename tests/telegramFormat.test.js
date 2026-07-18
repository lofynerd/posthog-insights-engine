const { splitForTelegram, sanitizeMarkdown, isInsideFence } = require("../src/utils/telegramFormat");

describe("sanitizeMarkdown", () => {
    it("converts double asterisks to single", () => {
        expect(sanitizeMarkdown("**bold text**")).toBe("*bold text*");
    });

    it("strips markdown heading markers", () => {
        expect(sanitizeMarkdown("### Heading\ncontent")).toBe("Heading\ncontent");
    });

    it("normalizes dash/asterisk bullet markers to •", () => {
        expect(sanitizeMarkdown("- item one\n* item two")).toBe("• item one\n• item two");
    });
});

describe("isInsideFence", () => {
    it("returns false before any fence", () => {
        expect(isInsideFence("plain text", 5)).toBe(false);
    });

    it("returns true when the index falls inside an open fence", () => {
        const text = "before\n```\ncode here\nmore code\n```\nafter";
        const insideIndex = text.indexOf("more code");
        expect(isInsideFence(text, insideIndex)).toBe(true);
    });

    it("returns false once a fence is closed", () => {
        const text = "before\n```\ncode\n```\nafter text here";
        const afterIndex = text.indexOf("after text");
        expect(isInsideFence(text, afterIndex)).toBe(false);
    });
});

describe("splitForTelegram", () => {
    it("returns the original text as a single chunk when under the limit", () => {
        expect(splitForTelegram("short message")).toEqual(["short message"]);
    });

    it("splits long text into multiple chunks at newline boundaries", () => {
        const line = "a".repeat(100);
        const text = Array(50).fill(line).join("\n"); // ~5000 chars
        const chunks = splitForTelegram(text, 4000);

        expect(chunks.length).toBeGreaterThan(1);
        chunks.forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(4000));
        expect(chunks.join("\n")).toContain(line);
    });

    it("never splits a message in the middle of an open code fence", () => {
        // Build a message where the natural split point (maxLength)
        // would land inside a ``` fenced block if fence-awareness
        // didn't kick in.
        const filler = "x".repeat(3900);
        const fenced = "```\n" + "diagram line\n".repeat(50) + "```";
        const text = `${filler}\n${fenced}\nafter fence text`;

        const chunks = splitForTelegram(text, 4000);

        chunks.forEach((chunk) => {
            const fenceCount = (chunk.match(/```/g) || []).length;
            expect(fenceCount % 2).toBe(0); // never an unbalanced fence within a single chunk
        });
    });

    it("preserves all content (no data loss) when fence-safety shifts a split point", () => {
        const filler = "x".repeat(3900);
        const fenced = "```\n" + "diagram line\n".repeat(50) + "```";
        const text = `${filler}\n${fenced}\nafter fence text`;

        const chunks = splitForTelegram(text, 4000);
        const rejoined = chunks.join("");

        // Chunk boundaries may trim incidental whitespace, but no
        // non-whitespace content should be lost or duplicated.
        expect(rejoined.replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
    });
});
