const config = require("../config");

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

function shouldLog(level) {
    const configuredLevel = config.app.logLevel;
    const configuredValue = levels[configuredLevel] ?? levels.info;

    return levels[level] <= configuredValue;
}

function write(level, message, metadata) {
    if (!shouldLog(level)) {
        return;
    }

    const payload = metadata ? [message, metadata] : [message];

    if (level === "error") {
        console.error(...payload);
        return;
    }

    if (level === "warn") {
        console.warn(...payload);
        return;
    }

    console.log(...payload);
}

module.exports = {
    info(message, metadata) {
        write("info", message, metadata);
    },
    warn(message, metadata) {
        write("warn", message, metadata);
    },
    error(message, metadata) {
        write("error", message, metadata);
    },
    debug(message, metadata) {
        write("debug", message, metadata);
    },
};
