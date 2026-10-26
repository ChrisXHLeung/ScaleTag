FROM node:24-alpine AS base
ARG SYSTEM_UPDATE_REVISION=manual
RUN printf 'System update revision: %s\n' "$SYSTEM_UPDATE_REVISION" \
    && apk update \
    && apk upgrade --no-cache \
    && rm -rf /var/cache/apk/*

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS runtime
RUN apk add --no-cache flock \
    && mkdir -p /data \
    && chown node:node /data \
    && chmod 0700 /data
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY deploy/healthcheck.js ./healthcheck.js
COPY --chmod=0555 deploy/docker-entrypoint.sh /usr/local/bin/scaletag-entrypoint
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=1s --retries=3 \
    CMD ["node", "/app/healthcheck.js"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["scaletag-entrypoint"]
CMD ["node", "src/server.js"]
