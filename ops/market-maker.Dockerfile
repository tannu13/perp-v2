FROM oven/bun:alpine
WORKDIR /app

COPY package.json bun.lock ./

COPY apps/market-maker/package.json apps/market-maker/bun.lock* ./apps/market-maker/
COPY packages/ ./packages/

RUN bun install

COPY apps/market-maker ./apps/market-maker

CMD ["bun", "apps/market-maker/src/index.ts"]
