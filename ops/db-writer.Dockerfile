FROM oven/bun:alpine
WORKDIR /app

COPY package.json bun.lock ./

COPY apps/db-writer/package.json apps/db-writer/bun.lock* ./apps/db-writer/
COPY packages/ ./packages/

RUN bun install

COPY apps/db-writer ./apps/db-writer

CMD ["bun", "apps/db-writer/src/index.ts"]