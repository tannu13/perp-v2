import { createClient, type RedisClientType } from "redis";
import { type TEngineSupportedTypes } from "@repo/shared/redis-events";
import env from "../env";
import {
  attachRedisLogging,
  redisClientOptions,
} from "@repo/shared/redis-resilience";

export const setupComms = async () => {
  /**
   * These two had no `error` listener at all — and an `error` event with no
   * listener is thrown by EventEmitter itself, so a Redis blip took the
   * scheduler down by a second route entirely (D19).
   */
  const schedulerClient: RedisClientType = createClient(
    redisClientOptions(env.REDIS_URL),
  );
  attachRedisLogging(schedulerClient, "scheduler");

  const senderClient: RedisClientType = createClient(
    redisClientOptions(env.REDIS_URL),
  );
  attachRedisLogging(senderClient, "scheduler sender");

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
