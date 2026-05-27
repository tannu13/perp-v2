import { createNodeRedisClient, Job, Queue, Worker } from "bullmq";
import type { RedisClientType } from "redis";
import type { THandlerType } from "./createHandler";

export const createScheduler = async (
  client: RedisClientType,
  handler: THandlerType,
) => {
  const connection = createNodeRedisClient(client as any);
  const queue = new Queue("perps-scheduler-events", { connection });

  await queue.upsertJobScheduler(
    "backup-scheduler",
    { pattern: "*/15 * * * *" },
    { name: "backup-event" },
  );
  await queue.upsertJobScheduler(
    "funding-rate-dispersal",
    { pattern: "0 * * * *" },
    { name: "funding-rate-dispersal" },
  );

  new Worker(
    queue.name,
    async (job: Job) => {
      // hit the redis stream with the backup event or funding-rate-dispersal event
      // figure out which job is this
      if (job.name === "backup-event") {
        await handler.backupTrigger();
      }

      if (job.name === "funding-rate-dispersal") {
        await handler.fundingRateDispersal();
      }

      // Do something with job
      return "some value";
    },
    { connection },
  );
};
