# syntax=docker/dockerfile:1
# Spare Parts / Pharmacy as an IntraForge service application (platform mode), reproducing the layout of the image
# shipped in IntraForge kit 1.4.0: the same Node release, settings, user, port and health check.
#
#   docker build -t intraforge-shop-spareparts:<tag> --build-arg SPAREPARTS_VERSION=<version> .
#   docker build -t intraforge-shop-pharmacy:<tag> --build-arg APP_EDITION=pharmacy \
#       --build-arg NEXT_PUBLIC_BASE_PATH=/apps/pharmacy --build-arg SPAREPARTS_VERSION=<version> .

FROM node:24.21.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24.21.0-alpine AS build
WORKDIR /app
ARG APP_EDITION=spare-parts
ARG NEXT_PUBLIC_BASE_PATH=/apps/spare-parts
ENV APP_EDITION=$APP_EDITION NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24.21.0-alpine
WORKDIR /app
ARG APP_EDITION=spare-parts
ARG NEXT_PUBLIC_BASE_PATH=/apps/spare-parts
ARG SPAREPARTS_VERSION=dev
ENV APP_EDITION=$APP_EDITION
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 SPAREPARTS_MODE=platform \
    SPAREPARTS_VERSION=$SPAREPARTS_VERSION INTRAFORGE_INTERNAL_URL=http://backend:8000 \
    SPAREPARTS_PG_HOST=postgres-tenant SPAREPARTS_PG_PORT=5432
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:3000${NEXT_PUBLIC_BASE_PATH}/api/v1/health" || exit 1
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
