FROM oven/bun:alpine
WORKDIR /app

COPY package.json bun.lock ./

COPY apps/price-poller/package.json apps/price-poller/bun.lock* ./apps/price-poller/
COPY packages/ ./packages/

RUN bun install

COPY apps/price-poller ./apps/price-poller

CMD ["bun", "apps/price-poller/src/index.ts"]