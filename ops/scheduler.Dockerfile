FROM oven/bun:alpine
WORKDIR /app

COPY package.json bun.lock ./

COPY apps/scheduler/package.json apps/scheduler/bun.lock* ./apps/scheduler/
COPY packages/ ./packages/

RUN bun install

COPY apps/scheduler ./apps/scheduler

CMD ["bun", "apps/scheduler/src/index.ts"]