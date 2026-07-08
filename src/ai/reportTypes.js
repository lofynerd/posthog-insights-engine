/**
 * Report type definitions.
 *
 * Single source of truth for the 4 audience-specific reports. Keeping
 * this as plain data (not scattered across prompt strings) means the
 * Telegram bot, the AI service, and the group registry can all agree
 * on the same set of valid report types.
 */
const REPORT_TYPES = {
    founder: {
        key: "founder",
        title: "👑 Founder / CEO Report",
        goal: "Help make business decisions quickly.",
        focusAreas: [
            "Overall business health score",
            "Visitor growth",
            "Conversion rate",
            "Top acquisition channels",
            "Revenue indicators (when available)",
            "Best-performing landing pages",
            "Biggest opportunities",
            "Biggest risks",
            "AI executive summary",
            "Top 3 recommended actions",
            "Confidence score",
        ],
        targetReadSeconds: 60,
    },
    marketing: {
        key: "marketing",
        title: "📈 Marketing Report",
        goal: "Improve traffic and campaign performance.",
        focusAreas: [
            "Traffic sources (Google, Instagram, Direct, etc.)",
            "Campaign performance",
            "Landing page performance",
            "SEO growth",
            "Organic vs Social traffic",
            "Device breakdown",
            "Browser breakdown",
            "Conversion by traffic source",
            "User engagement",
            "Marketing recommendations",
            "Confidence score",
        ],
    },
    pr: {
        key: "pr",
        title: "📢 PR Report",
        goal: "Understand audience growth and identify content opportunities.",
        focusAreas: [
            "Audience growth trends",
            "Geographic expansion",
            "Top-performing content",
            "Referral sources",
            "Brand visibility trends",
            "Emerging markets",
            "Viral content detection",
            "Customer interests",
            "Suggested PR/content opportunities",
            "Confidence score",
        ],
    },
    developer: {
        key: "developer",
        title: "💻 Developer Report",
        goal: "Monitor technical quality and user experience.",
        focusAreas: [
            "Browser usage",
            "Device usage",
            "Operating systems",
            "Screen sizes",
            "Performance metrics (if available)",
            "Errors (future)",
            "Page load trends",
            "User flow anomalies",
            "Technical recommendations",
            "Confidence score",
        ],
    },
};

const VALID_REPORT_TYPES = Object.freeze(Object.keys(REPORT_TYPES));

function isValidReportType(value) {
    return VALID_REPORT_TYPES.includes(value);
}

module.exports = { REPORT_TYPES, VALID_REPORT_TYPES, isValidReportType };
