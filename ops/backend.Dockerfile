FROM oven/bun:alpine
WORKDIR /app

COPY package.json bun.lock ./

COPY apps/backend/package.json apps/backend/bun.lock* ./apps/backend/
COPY packages/ ./packages/

RUN bun install

COPY apps/backend ./apps/backend

EXPOSE 3000

CMD ["bun", "apps/backend/src/index.ts"]