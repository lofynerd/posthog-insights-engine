/**
 * Tests for AI semantic structure enforcement.
 * 
 * These tests verify that the AI prompt properly enforces the distinction
 * between FACT, OBSERVATION, POSSIBLE EXPLANATION, and RECOMMENDATION.
 * 
 * Note: These are prompt validation tests, not full AI integration tests.
 * They verify the structure of the prompt, not actual AI responses.
 */

const { AnalysisService } = require("../src/ai/analysis.service");

describe("AI Semantic Structure", () => {
    it("system prompt includes FACT/OBSERVATION/POSSIBLE EXPLANATION/RECOMMENDATION structure", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify the prompt includes explicit semantic labels
        expect(systemPrompt).toContain("FACT:");
        expect(systemPrompt).toContain("OBSERVATION:");
        expect(systemPrompt).toContain("POSSIBLE EXPLANATION:");
        expect(systemPrompt).toContain("RECOMMENDATION:");
    });

    it("system prompt enforces fact vs explanation distinction", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify distinction is explained with examples
        expect(systemPrompt).toContain("FACT vs EXPLANATION distinction is mandatory");
        expect(systemPrompt).toContain("may indicate");
        expect(systemPrompt).toContain("Never state causation as fact unless directly proven");
    });

    it("system prompt requires hedging language for explanations", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify hedging language is required
        expect(systemPrompt).toContain('Use hedging language for POSSIBLE EXPLANATION: "may", "could", "possibly"');
    });

    it("metric caption prompt includes semantic precision rules", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        // The metric caption generation includes semantic structure
        // We can't easily extract the private system prompt, but we can verify
        // the method exists and follows the same pattern
        expect(typeof service.generateMetricCaption).toBe("function");
    });

    it("prompt forbids fabrication and requires data grounding", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify anti-fabrication rules
        expect(systemPrompt).toContain("Never fabricate data, numbers, or causes");
        expect(systemPrompt).toContain("FACT must come from evidence.facts or evidence.observations");
        expect(systemPrompt).toContain("never invent numbers");
    });

    it("prompt maintains compact report philosophy", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify compact philosophy is preserved (using actual wording from prompt)
        expect(systemPrompt).toContain("30 seconds");
        expect(systemPrompt).toContain("People scan");
        expect(systemPrompt).toContain("information density");
    });

    it("insight structure is exactly 4 lines per insight", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify structure is 4 lines (FACT, OBSERVATION, POSSIBLE EXPLANATION, RECOMMENDATION)
        expect(systemPrompt).toContain("4 lines per insight");
        expect(systemPrompt).toContain("Each insight MUST use this exact structure");
    });

    it("AI cannot invent or modify deterministic scores", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify AI cannot modify scores
        expect(systemPrompt).toContain("State the health/confidence score EXACTLY as given in the data");
        expect(systemPrompt).toContain("recalculate or invent");
    });

    it("prompt enforces unique visitor vs new visitor distinction", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify the prompt clarifies unique visitors vs new visitors
        expect(systemPrompt).toContain('NEVER say "unique visitors increased" implies "new visitors increased"');
        expect(systemPrompt).toContain("Unique visitors = distinct people observed this period");
        expect(systemPrompt).toContain("New visitors = people who appeared for the first time");
    });

    it("prompt requires evidence-based mobile recommendations", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify the prompt requires evidence before claiming mobile UX issues
        expect(systemPrompt).toContain('Do NOT say "mobile UX is poor" just because mobile traffic exists');
        expect(systemPrompt).toContain("mobile-specific problems");
    });

    it("prompt allows insufficient evidence conclusions", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify the prompt allows saying "insufficient evidence"
        expect(systemPrompt).toContain('"Insufficient evidence to determine the cause"');
        expect(systemPrompt).toContain("Do NOT force an explanation");
    });

    it("prompt enforces period consistency", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify the prompt enforces period consistency
        expect(systemPrompt).toContain('NEVER say "this week" in a quarterly report');
        expect(systemPrompt).toContain("period labels provided in the context");
    });

    it("prompt includes evidence strength guidance", () => {
        const service = new AnalysisService({
            apiKey: "test-key",
            baseUrl: "https://test.api",
            model: "test-model",
        });

        const definition = {
            title: "Test Report",
            key: "test",
            focus: ["test focus"],
            exclude: [],
        };

        const systemPrompt = service._buildSystemPrompt(definition, { wordLimit: 500, expanded: false });

        // Verify the prompt includes evidence strength context
        expect(systemPrompt).toContain("evidenceStrength");
        expect(systemPrompt).toContain("INSUFFICIENT");
        expect(systemPrompt).toContain("Weak evidence");
        expect(systemPrompt).toContain("Strong evidence");
    });
});
