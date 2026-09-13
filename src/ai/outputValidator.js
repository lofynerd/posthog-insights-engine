/**
 * AI Output Validator
 * 
 * Validates AI-generated report text to ensure it follows required structure
 * and doesn't contain obviously malformed analytical output.
 * 
 * This is a defense-in-depth measure - the prompt should prevent these issues,
 * but validation catches failures before they reach users.
 */

/**
 * Check if report contains required sections.
 * 
 * @param {string} reportText - AI-generated report
 * @returns {object} { valid: boolean, missingSections: array }
 */
function validateRequiredSections(reportText) {
    const requiredSections = [
        "Health Score:",
        "Confidence:",
        "📈 KPI Snapshot",
        "🔥 Biggest Win",
        "⚠ Biggest Risk",
        "🧠 AI Insights",
        "🎯 Top Priorities",
        "📅 Immediate Action",
        "🤖 Executive Verdict",
    ];
    
    const missingSections = requiredSections.filter((section) => !reportText.includes(section));
    
    return {
        valid: missingSections.length === 0,
        missingSections,
    };
}

/**
 * Check for banned phrases that indicate AI didn't follow instructions.
 * 
 * @param {string} reportText - AI-generated report
 * @returns {object} { valid: boolean, foundBanned: array }
 */
function validateNoBannedPhrases(reportText) {
    const bannedPhrases = [
        "it is important to note",
        "overall, ",
        "in conclusion",
        "the data suggests",
        "based on the analysis",
    ];
    
    const foundBanned = bannedPhrases.filter((phrase) =>
        reportText.toLowerCase().includes(phrase.toLowerCase())
    );
    
    return {
        valid: foundBanned.length === 0,
        foundBanned,
    };
}

/**
 * Check if report uses box-drawing characters (explicitly banned).
 * 
 * @param {string} reportText - AI-generated report
 * @returns {object} { valid: boolean, reason: string }
 */
function validateNoBoxDrawing(reportText) {
    const boxDrawingChars = ['─', '━', '│', '┃', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼'];
    
    const foundBoxChars = boxDrawingChars.filter((char) => reportText.includes(char));
    
    return {
        valid: foundBoxChars.length === 0,
        reason: foundBoxChars.length > 0 ? `Found banned box-drawing characters: ${foundBoxChars.join(", ")}` : null,
    };
}

/**
 * Check if scores are present and appear unchanged.
 * AI should state them exactly as provided, not recalculate.
 * 
 * @param {string} reportText - AI-generated report
 * @param {object} healthScore - Expected health score object
 * @param {number} confidenceScore - Expected confidence score
 * @returns {object} { valid: boolean, issues: array }
 */
function validateScoresPresent(reportText, healthScore, confidenceScore) {
    const issues = [];
    
    if (healthScore && typeof healthScore.score === "number") {
        if (!reportText.includes(`Health Score: ${healthScore.score}`)) {
            issues.push(`Health Score ${healthScore.score} not found in report`);
        }
    }
    
    if (typeof confidenceScore === "number") {
        if (!reportText.includes(`Confidence: ${confidenceScore}`)) {
            issues.push(`Confidence ${confidenceScore} not found in report`);
        }
    }
    
    return {
        valid: issues.length === 0,
        issues,
    };
}

/**
 * Check if AI insights follow the 4-line structure.
 * This is a heuristic check - we look for the semantic labels.
 * 
 * @param {string} reportText - AI-generated report
 * @returns {object} { valid: boolean, issues: array }
 */
function validateInsightStructure(reportText) {
    const issues = [];
    
    // Extract the AI Insights section
    const insightsMatch = reportText.match(/🧠 AI Insights([\s\S]*?)🎯 Top Priorities/);
    if (!insightsMatch) {
        // Section might be missing or malformed, but validateRequiredSections will catch that
        return { valid: true, issues: [] };
    }
    
    const insightsSection = insightsMatch[1];
    
    // Count bullet points (insights)
    const bulletCount = (insightsSection.match(/^•/gm) || []).length;
    
    if (bulletCount > 5) {
        issues.push(`Too many insights: ${bulletCount} (max 5)`);
    }
    
    // Check if insights contain the semantic labels (at least some)
    const hasFact = insightsSection.includes("FACT:");
    const hasObservation = insightsSection.includes("OBSERVATION:");
    const hasPossibleExplanation = insightsSection.includes("POSSIBLE EXPLANATION:");
    const hasRecommendation = insightsSection.includes("RECOMMENDATION:");
    
    // If there are insights, at least some should have semantic structure
    if (bulletCount > 0 && !hasFact && !hasObservation) {
        issues.push("Insights missing FACT/OBSERVATION semantic structure");
    }
    
    return {
        valid: issues.length === 0,
        issues,
    };
}

/**
 * Check for percentage formatting issues.
 * AI should use formatted percentages from evidence, not raw decimals.
 * 
 * @param {string} reportText - AI-generated report
 * @returns {object} { valid: boolean, issues: array }
 */
function validatePercentageFormatting(reportText) {
    const issues = [];
    
    // Look for suspicious decimal patterns that look like percentages (0.XX appearing as metric values)
    // This is heuristic - we look for "rate 0." or "rate: 0." which likely should be percentages
    const suspiciousPatterns = [
        /rate[:\s]+0\.\d{2,}/gi,
        /growth[:\s]+0\.\d{2,}/gi,
    ];
    
    suspiciousPatterns.forEach((pattern) => {
        const matches = reportText.match(pattern);
        if (matches) {
            issues.push(`Possible unformatted percentage: ${matches[0]}`);
        }
    });
    
    return {
        valid: issues.length === 0,
        issues,
    };
}

/**
 * Comprehensive validation of AI-generated report.
 * 
 * @param {string} reportText - AI-generated report
 * @param {object} context - Context including healthScore, confidenceScore
 * @returns {object} { valid: boolean, errors: array, warnings: array }
 */
function validateReport(reportText, context = {}) {
    const errors = [];
    const warnings = [];
    
    // Required sections
    const sectionsCheck = validateRequiredSections(reportText);
    if (!sectionsCheck.valid) {
        errors.push(...sectionsCheck.missingSections.map((s) => `Missing section: ${s}`));
    }
    
    // Banned phrases
    const bannedCheck = validateNoBannedPhrases(reportText);
    if (!bannedCheck.valid) {
        warnings.push(...bannedCheck.foundBanned.map((p) => `Found banned phrase: "${p}"`));
    }
    
    // Box drawing
    const boxCheck = validateNoBoxDrawing(reportText);
    if (!boxCheck.valid) {
        warnings.push(boxCheck.reason);
    }
    
    // Scores
    if (context.healthScore || context.confidenceScore) {
        const scoresCheck = validateScoresPresent(reportText, context.healthScore, context.confidenceScore);
        if (!scoresCheck.valid) {
            errors.push(...scoresCheck.issues);
        }
    }
    
    // Insight structure
    const insightCheck = validateInsightStructure(reportText);
    if (!insightCheck.valid) {
        warnings.push(...insightCheck.issues);
    }
    
    // Percentage formatting
    const percentCheck = validatePercentageFormatting(reportText);
    if (!percentCheck.valid) {
        warnings.push(...percentCheck.issues);
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

module.exports = {
    validateRequiredSections,
    validateNoBannedPhrases,
    validateNoBoxDrawing,
    validateScoresPresent,
    validateInsightStructure,
    validatePercentageFormatting,
    validateReport,
};
