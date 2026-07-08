# syntax=docker/dockerfile:1

# --- Build stage: install deps with dev deps available for any prepare/build steps ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Runtime stage: minimal image, no build tools, no dev dependencies ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as a non-root, unprivileged user rather than the container
# default root, in case of a dependency compromise or RCE the process
# doesn't have root inside the container.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --chown=appuser:appgroup package.json package-lock.json ./
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup src ./src

USER appuser

# The bot is a long-lived long-polling process (no HTTP server, so no
# EXPOSE/port needed). Liveness is reported via a heartbeat file the
# main loop touches every 15s (see src/bot.js + src/healthcheck.js),
# since there's no port to probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node src/healthcheck.js

CMD ["node", "src/bot.js"]
