/**
 * Relevance Guard
 *
 * Protects AI credits from misuse: group members could otherwise ask
 * the bot to write essays, solve homework, or chat about anything,
 * burning API spend unrelated to the brand's analytics.
 *
 * Two-stage defense:
 *  1. Fast, free heuristic reject for obviously unrelated requests
 *     (common off-topic patterns) — no AI call spent.
 *  2. Cheap AI classification call (tiny max_tokens) for anything
 *     that passes stage 1, before the expensive full-answer call
 *     is ever made.
 *
 * This module only classifies; src/ai/qa.service.js decides what to
 * do with the result.
 */

const OFF_TOPIC_PATTERNS = [
    /write (me )?(a|an) (poem|essay|story|song|joke)/i,
    /\btranslate\b/i,
    /\bhomework\b/i,
    /\brecipe\b/i,
    /\bcode\s+(for|to)\b.*\b(python|javascript|java|c\+\+)\b/i,
    /\bwho (is|was)\b(?!.*\b(tomasi|visitor|customer|user)\b)/i,
    /\bweather\b/i,
    /\bstock price\b/i,
    /\bcapital of\b/i,
    /\bmeaning of life\b/i,
];

const MAX_QUESTION_LENGTH = 500;

function heuristicReject(question) {
    if (typeof question !== "string" || question.trim().length === 0) {
        return true;
    }
    if (question.length > MAX_QUESTION_LENGTH) {
        return true;
    }
    return OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(question));
}

/**
 * @param {object} deps
 * @param {import("./analysis.service").AnalysisService} deps.client - AI client wrapper exposing rawCompletion().
 * @param {string} brandName - Brand name to scope relevance against.
 * @param {string} question - Untrusted, user-submitted question text.
 * @returns {Promise<boolean>} true if the question is in-scope.
 */
async function isRelevant({ client, brandName, question }) {
    if (heuristicReject(question)) {
        return false;
    }

    const classification = await client.classify(
        `You are a strict scope classifier for a business analytics bot for the brand "${brandName}".
Reply with exactly one word and nothing else: RELEVANT or NOT_RELEVANT.

RELEVANT means the question is about:
- ${brandName}'s website/product analytics, traffic, visitors, conversions, sales, marketing, PR, or technical performance
- requests for reports, comparisons, or explanations of the brand's data

NOT_RELEVANT means anything else: general knowledge, personal requests, other companies,
creative writing, coding help unrelated to this analytics data, or any topic not about
${brandName}'s analytics.

Question: "${question.replace(/"/g, "'")}"`,
        { maxTokens: 16 }
    );

    return /^RELEVANT\b/i.test(classification.trim());
}

module.exports = { isRelevant, heuristicReject, MAX_QUESTION_LENGTH };
