FROM oven/bun:alpine
WORKDIR /app

COPY package.json bun.lock ./

COPY apps/ws-server/package.json apps/ws-server/bun.lock* ./apps/ws-server/
COPY packages/ ./packages/

RUN bun install

COPY apps/ws-server ./apps/ws-server

CMD ["bun", "apps/ws-server/src/index.ts"]