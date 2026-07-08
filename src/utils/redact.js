/**
 * Secret redaction utility.
 *
 * Any log line, error message, or thrown error can end up in
 * CloudWatch, a CI log, or a support ticket. This module strips known
 * secret shapes and sensitive key names before anything is written out.
 */

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|authorization|secret|password|access[_-]?key)/i;

// Known credential shapes used in this project, matched defensively
// even if they show up inside a plain string (e.g. an interpolated
// error message) rather than a structured object field.
const SECRET_VALUE_PATTERNS = [
    /Bearer\s+[A-Za-z0-9._~+/=:-]+/gi, // Authorization header values
    /phx_[A-Za-z0-9]+/g, // PostHog personal API keys
    /phc_[A-Za-z0-9]+/g, // PostHog project API tokens
    /\b\d{10}:[A-Za-z0-9_-]{30,}\b/g, // Telegram bot tokens (id:secret)
    /AIza[A-Za-z0-9_-]{20,}/g, // Google/Gemini API keys
    /AQ\.[A-Za-z0-9_-]{20,}/g, // Google OAuth-style access tokens
    /AKIA[0-9A-Z]{16}/g, // AWS access key IDs
    /ASIA[0-9A-Z]{16}/g, // AWS temporary/STS access key IDs
    /\b(?=[A-Za-z0-9/+=]{40}\b)(?=[A-Za-z0-9/+=]*[a-z])(?=[A-Za-z0-9/+=]*[A-Z])(?=[A-Za-z0-9/+=]*\d)[A-Za-z0-9/+=]{40}\b/g, // AWS secret access key shape (40 char base64, mixed case + digit)
];

function maskValue(value) {
    if (typeof value !== "string" || value.length === 0) {
        return value;
    }

    if (value.length <= 8) {
        return "***";
    }

    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Redact secret-shaped substrings inside a plain string.
 */
function redactString(input) {
    if (typeof input !== "string") {
        return input;
    }

    return SECRET_VALUE_PATTERNS.reduce(
        (text, pattern) => text.replace(pattern, (match) => maskValue(match)),
        input
    );
}

/**
 * Deeply redact an object/array/primitive for safe logging.
 * - Keys matching known secret names are fully masked.
 * - String values are scanned for known secret shapes.
 * - Circular references and class instances (e.g. Error) are handled
 *   defensively rather than throwing.
 */
function redact(value, seen = new WeakSet()) {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === "string") {
        return redactString(value);
    }

    if (typeof value !== "object") {
        return value;
    }

    if (seen.has(value)) {
        return "[Circular]";
    }
    seen.add(value);

    if (value instanceof Error) {
        return redactString(value.message);
    }

    if (Array.isArray(value)) {
        return value.map((item) => redact(item, seen));
    }

    const output = {};
    for (const [key, val] of Object.entries(value)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            output[key] = typeof val === "string" ? maskValue(val) : "***";
        } else {
            output[key] = redact(val, seen);
        }
    }
    return output;
}

module.exports = { redact, redactString, maskValue };
