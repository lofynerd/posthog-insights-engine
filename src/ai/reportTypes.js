/**
 * Report type definitions.
 *
 * Canonical audiences: board, marketing, pr, development.
 *
 * "board" replaces the old "founder" report, and "development"
 * replaces the old "developer" report — renamed to match the new
 * Tomasi AI persona spec. REPORT_TYPE_ALIASES keeps old group
 * registrations (stored as "founder"/"developer" in S3 before this
 * change) resolving correctly without forcing every group to re-run
 * /register.
 */
const REPORT_TYPES = {
    board: {
        key: "board",
        title: "🏛️ Board Report",
        emoji: "🏛️",
        goal: "Revenue, growth, business health, major risks/opportunities, financial impact, strategic recommendations. No technical implementation detail.",
        focus: ["Revenue", "Growth", "Business Health", "Major Risks", "Major Opportunities", "Financial Impact", "Strategic Recommendations"],
        exclude: ["infrastructure", "AWS", "technical implementation detail"],
    },
    marketing: {
        key: "marketing",
        title: "📈 Marketing Report",
        emoji: "📈",
        goal: "Traffic, campaigns, SEO, social, funnels, content, acquisition. No infrastructure.",
        focus: ["Traffic", "Campaigns", "SEO", "Social", "Funnels", "Content", "Acquisition"],
        exclude: ["infrastructure"],
    },
    pr: {
        key: "pr",
        title: "📢 PR Report",
        emoji: "📢",
        goal: "Brand visibility, audience growth, media reach, engagement, referral sources, sentiment, brand awareness, content performance. No AWS or infrastructure.",
        focus: ["Brand Visibility", "Audience Growth", "Media Reach", "Engagement", "Referral Sources", "Sentiment", "Brand Awareness", "Content Performance"],
        exclude: ["AWS", "infrastructure"],
    },
    development: {
        key: "development",
        title: "💻 Development Report",
        emoji: "💻",
        goal: "Infrastructure, API, errors, deployments, cloud, performance, security, CloudWatch, database, latency, costs. Never discuss marketing.",
        focus: ["Infrastructure", "API", "Errors", "Deployments", "Cloud", "Performance", "Security", "CloudWatch", "Database", "Latency", "Costs"],
        exclude: ["marketing"],
    },
};

// Old names -> canonical names. Anything reading a report type
// (bot commands, group registry lookups, prompt building) should
// resolve through normalizeReportType() before use.
const REPORT_TYPE_ALIASES = {
    founder: "board",
    developer: "development",
};

const VALID_REPORT_TYPES = Object.freeze(Object.keys(REPORT_TYPES));

/**
 * Resolve a possibly-legacy report type name to its canonical form.
 * Returns null if the value isn't a known type or alias.
 */
function normalizeReportType(value) {
    if (typeof value !== "string") return null;
    const lower = value.toLowerCase();
    if (REPORT_TYPES[lower]) return lower;
    if (REPORT_TYPE_ALIASES[lower]) return REPORT_TYPE_ALIASES[lower];
    return null;
}

function isValidReportType(value) {
    return normalizeReportType(value) !== null;
}

/**
 * Word budget per report, per the Tomasi AI philosophy: reports must
 * be scannable in ~30 seconds, not read like documents.
 *
 * Board reports always use the board cap regardless of period.
 * Every other audience is capped by how far back the period looks —
 * a daily snapshot has less to say than a monthly one.
 */
const PERIOD_WORD_LIMITS = {
    latest: 350, // "daily" in the spec
    weekly: 500,
    monthly: 700,
    quarterly: 700, // not specified in the spec; treated as monthly-equivalent
};
const BOARD_WORD_LIMIT = 600;

function wordLimitFor(reportType, periodType) {
    const canonical = normalizeReportType(reportType);
    if (canonical === "board") return BOARD_WORD_LIMIT;
    return PERIOD_WORD_LIMITS[periodType] ?? PERIOD_WORD_LIMITS.weekly;
}

module.exports = {
    REPORT_TYPES,
    REPORT_TYPE_ALIASES,
    VALID_REPORT_TYPES,
    PERIOD_WORD_LIMITS,
    BOARD_WORD_LIMIT,
    normalizeReportType,
    isValidReportType,
    wordLimitFor,
};
