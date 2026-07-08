const { isRelevant, heuristicReject, MAX_QUESTION_LENGTH } = require("../src/ai/relevanceGuard");

describe("heuristicReject", () => {
    it("rejects empty or non-string input", () => {
        expect(heuristicReject("")).toBe(true);
        expect(heuristicReject("   ")).toBe(true);
        expect(heuristicReject(null)).toBe(true);
    });

    it("rejects overly long questions", () => {
        expect(heuristicReject("a".repeat(MAX_QUESTION_LENGTH + 1))).toBe(true);
    });

    it("rejects common off-topic patterns", () => {
        expect(heuristicReject("Write me a poem about the ocean")).toBe(true);
        expect(heuristicReject("Can you translate this to French")).toBe(true);
        expect(heuristicReject("Help me with my homework please")).toBe(true);
        expect(heuristicReject("What's a good recipe for pasta")).toBe(true);
        expect(heuristicReject("What's the weather like today")).toBe(true);
        expect(heuristicReject("What is the capital of France")).toBe(true);
    });

    it("allows plausible analytics questions through to the AI classifier", () => {
        expect(heuristicReject("What was our conversion rate this week?")).toBe(false);
        expect(heuristicReject("How many visitors came from Instagram?")).toBe(false);
        expect(heuristicReject("Whats our bounce rate looking like")).toBe(false);
    });
});

describe("isRelevant", () => {
    function mockClient(responseText) {
        return { classify: jest.fn().mockResolvedValue(responseText) };
    }

    it("short-circuits on heuristic rejection without calling the AI client", async () => {
        const client = mockClient("RELEVANT");
        const result = await isRelevant({ client, brandName: "Tomasi", question: "write me a poem" });

        expect(result).toBe(false);
        expect(client.classify).not.toHaveBeenCalled();
    });

    it("returns true when the AI classifies the question as relevant", async () => {
        const client = mockClient("RELEVANT");
        const result = await isRelevant({
            client,
            brandName: "Tomasi",
            question: "What was our top traffic source?",
        });

        expect(result).toBe(true);
        expect(client.classify).toHaveBeenCalledTimes(1);
    });

    it("returns false when the AI classifies the question as not relevant", async () => {
        const client = mockClient("NOT_RELEVANT");
        const result = await isRelevant({
            client,
            brandName: "Tomasi",
            question: "Tell me a fun fact about space",
        });

        expect(result).toBe(false);
    });

    it("treats an ambiguous/malformed AI response as not relevant (fail closed)", async () => {
        const client = mockClient("I'm not sure what you mean");
        const result = await isRelevant({
            client,
            brandName: "Tomasi",
            question: "What was our top traffic source?",
        });

        expect(result).toBe(false);
    });
});
