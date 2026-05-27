import { createClient, type RedisClientType } from "redis";
import { type TEngineSupportedTypes } from "@repo/shared/redis-events";
import env from "../env";

export const setupComms = async () => {
  const schedulerClient: RedisClientType = createClient({
    url: env.REDIS_URL,
  });

  const senderClient: RedisClientType = createClient({
    url: env.REDIS_URL,
  });

  await Promise.all([schedulerClient.connect(), senderClient.connect()]);

  const sendToEngineStream = async (type: TEngineSupportedTypes) => {
    const correlationId = crypto.randomUUID();
    await senderClient.xAdd(env.ENGINE_ON_STREAM, "*", {
      correlationId,
      type,
      payload: JSON.stringify({ now: new Date().toISOString() }),
    });
  };

  return { rediClient: schedulerClient, sendToEngineStream };
};

export type TSendToEngineStream = Awaited<
  ReturnType<typeof setupComms>
>["sendToEngineStream"];
export type TSendToEngineStreamArgs = Parameters<TSendToEngineStream>;
