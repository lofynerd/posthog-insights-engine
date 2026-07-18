const {
    REPORT_TYPES,
    VALID_REPORT_TYPES,
    normalizeReportType,
    isValidReportType,
    wordLimitFor,
} = require("../src/ai/reportTypes");

describe("normalizeReportType", () => {
    it("returns canonical names unchanged", () => {
        expect(normalizeReportType("board")).toBe("board");
        expect(normalizeReportType("marketing")).toBe("marketing");
        expect(normalizeReportType("pr")).toBe("pr");
        expect(normalizeReportType("development")).toBe("development");
    });

    it("resolves legacy aliases to canonical names", () => {
        expect(normalizeReportType("founder")).toBe("board");
        expect(normalizeReportType("developer")).toBe("development");
    });

    it("is case-insensitive", () => {
        expect(normalizeReportType("BOARD")).toBe("board");
        expect(normalizeReportType("Founder")).toBe("board");
    });

    it("returns null for unknown values", () => {
        expect(normalizeReportType("attacker-controlled")).toBeNull();
        expect(normalizeReportType("")).toBeNull();
        expect(normalizeReportType(null)).toBeNull();
        expect(normalizeReportType(undefined)).toBeNull();
        expect(normalizeReportType(123)).toBeNull();
    });
});

describe("isValidReportType", () => {
    it("accepts canonical and legacy names", () => {
        expect(isValidReportType("board")).toBe(true);
        expect(isValidReportType("founder")).toBe(true);
        expect(isValidReportType("development")).toBe(true);
        expect(isValidReportType("developer")).toBe(true);
    });

    it("rejects unknown values", () => {
        expect(isValidReportType("finance")).toBe(false);
    });
});

describe("REPORT_TYPES / VALID_REPORT_TYPES", () => {
    it("exposes exactly the 4 canonical audiences", () => {
        expect([...VALID_REPORT_TYPES].sort()).toEqual(["board", "development", "marketing", "pr"].sort());
    });

    it("every report type has focus areas and a title", () => {
        VALID_REPORT_TYPES.forEach((key) => {
            expect(REPORT_TYPES[key].title).toBeTruthy();
            expect(REPORT_TYPES[key].focus.length).toBeGreaterThan(0);
        });
    });

    it("board excludes infrastructure/technical detail", () => {
        expect(REPORT_TYPES.board.exclude).toContain("infrastructure");
    });

    it("development excludes marketing", () => {
        expect(REPORT_TYPES.development.exclude).toContain("marketing");
    });

    it("marketing and pr exclude infrastructure/AWS", () => {
        expect(REPORT_TYPES.marketing.exclude).toContain("infrastructure");
        expect(REPORT_TYPES.pr.exclude.join(" ")).toMatch(/AWS|infrastructure/);
    });
});

describe("wordLimitFor", () => {
    it("caps board reports at 600 words regardless of period", () => {
        expect(wordLimitFor("board", "latest")).toBe(600);
        expect(wordLimitFor("board", "weekly")).toBe(600);
        expect(wordLimitFor("board", "monthly")).toBe(600);
        expect(wordLimitFor("founder", "quarterly")).toBe(600); // alias
    });

    it("scales non-board reports by period length", () => {
        expect(wordLimitFor("marketing", "latest")).toBe(350);
        expect(wordLimitFor("marketing", "weekly")).toBe(500);
        expect(wordLimitFor("marketing", "monthly")).toBe(700);
    });

    it("falls back to the weekly limit for an unknown period", () => {
        expect(wordLimitFor("marketing", "nonsense")).toBe(500);
    });
});
