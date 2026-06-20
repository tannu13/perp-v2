FROM oven/bun:alpine
WORKDIR /app

COPY package.json bun.lock ./

COPY apps/engine/package.json apps/engine/bun.lock* ./apps/engine/
COPY packages/ ./packages/

RUN bun install

COPY apps/engine ./apps/engine

CMD ["bun", "apps/engine/src/index.ts"]