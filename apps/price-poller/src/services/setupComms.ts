import { createClient } from "redis";
import { type TEngineSupportedTypes } from "@repo/shared/redis-events";
import env from "../env";

const OUTGOING_STREAM = env.OUTGOING_STREAM;

export const setupComms = async () => {
  const senderClient = await createClient({ url: env.REDIS_URL }).on(
    "error",
    (err) => console.log("Redis Client Error", err),
  );

  await Promise.all([senderClient.connect()]);

  const sendToResponseStream = async (
    type: TEngineSupportedTypes,
    payload: Record<string, unknown>,
  ) => {
    const correlationId = crypto.randomUUID();
    await senderClient.xAdd(OUTGOING_STREAM, "*", {
      correlationId,
      type,
      payload: JSON.stringify(payload),
    });
  };

  return { sendToResponseStream };
};

export type TSendToResponseStream = Awaited<
  ReturnType<typeof setupComms>
>["sendToResponseStream"];
export type SendToResponseStreamArgs = Parameters<TSendToResponseStream>;
