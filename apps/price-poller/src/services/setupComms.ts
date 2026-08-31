import { createClient } from "redis";
import { type TEngineSupportedTypes } from "@repo/shared/redis-events";
import env from "../env";
import {
  attachRedisLogging,
  isRedisConnectionError,
  redisClientOptions,
} from "@repo/shared/redis-resilience";

const OUTGOING_STREAM = env.OUTGOING_STREAM;

export const setupComms = async () => {
  const senderClient = createClient(redisClientOptions(env.REDIS_URL));
  attachRedisLogging(senderClient, "price-poller");

  await Promise.all([senderClient.connect()]);

  /**
   * The poller fires three of these a second and awaits none of them, so with
   * Redis down each one was an unhandled rejection and the process was gone
   * inside a tick (D19). A dropped spot tick is not data loss — the next one
   * is a second away and carries the current price — so a connection failure
   * is logged once per outage and dropped. Anything else still throws.
   */
  let outage = 0;
  const sendToResponseStream = async (
    type: TEngineSupportedTypes,
    payload: Record<string, unknown>,
  ) => {
    const correlationId = crypto.randomUUID();
    try {
      await senderClient.xAdd(OUTGOING_STREAM, "*", {
        correlationId,
        type,
        payload: JSON.stringify(payload),
      });
      if (outage > 0) {
        console.log(`redis is back — dropped ${outage} spot ticks`);
        outage = 0;
      }
    } catch (err) {
      if (!isRedisConnectionError(err)) throw err;
      outage += 1;
      if (outage === 1) {
        console.warn("lost redis — dropping spot ticks until it returns");
      }
    }
  };

  return { sendToResponseStream };
};

export type TSendToResponseStream = Awaited<
  ReturnType<typeof setupComms>
>["sendToResponseStream"];
export type SendToResponseStreamArgs = Parameters<TSendToResponseStream>;
