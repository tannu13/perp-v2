# Build from the repo root, and pass both URLs — they are baked in here, not
# read at run time (see the ARG block below):
#
#   docker build -f ops/web.Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.yourdomain \
#     --build-arg NEXT_PUBLIC_WS_URL=wss://ws.yourdomain \
#     -t perps-v2-web .
#
# Locally, against the stack on the host:
#
#   docker build -f ops/web.Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=http://localhost:3000 \
#     --build-arg NEXT_PUBLIC_WS_URL=ws://localhost:3010 \
#     -t perps-v2-web:local .
#   docker run --rm -p 3020:3020 perps-v2-web:local
#
# One image per environment, therefore. The same tag cannot be promoted from
# staging to production the way the bun services' images can.

FROM oven/bun:alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./

COPY apps/web/package.json apps/web/bun.lock* ./apps/web/
COPY packages/ ./packages/

RUN bun install

COPY apps/web ./apps/web

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN cd apps/web && bun run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3020 \
    HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3020

CMD ["node", "apps/web/server.js"]
