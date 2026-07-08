const fs = require("fs");

/**
 * Container health check for the long-polling bot process.
 *
 * The bot has no HTTP server to probe (Telegram long-polling + cron
 * only), so liveness is measured via a heartbeat file the main event
 * loop touches every 15s (see src/bot.js). If the file is missing or
 * stale, the event loop is considered hung/dead and ECS will restart
 * the task.
 *
 * Exits 0 (healthy) or 1 (unhealthy) — the exit code is all Docker's
 * HEALTHCHECK / ECS container health check reads.
 */
const HEARTBEAT_PATH = process.env.HEARTBEAT_PATH || "/tmp/bot-heartbeat";
const MAX_STALENESS_MS = 60_000; // must be written within the last 60s

try {
    const contents = fs.readFileSync(HEARTBEAT_PATH, "utf8");
    const lastBeat = Number(contents);

    if (!Number.isFinite(lastBeat)) {
        process.exit(1);
    }

    const staleness = Date.now() - lastBeat;
    process.exit(staleness <= MAX_STALENESS_MS ? 0 : 1);
} catch {
    // Heartbeat file doesn't exist yet (startup grace period handles
    // this) or can't be read — treat as unhealthy.
    process.exit(1);
}
