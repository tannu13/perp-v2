import { createClient } from "redis";
import env from "../env";
import {
  RawEngineResponseSchema,
  type TEngineSupportedTypes,
  type TStreamEngineResponse,
  EngineResponseSchema,
  type TStreamEngineResponseMessage,
  type TEngineResponseSchema,
} from "@repo/shared/redis-events";

// register with the redis stream
const INCOMING_STREAM = env.INCOMING_STREAM;
const OUTGOING_STREAM = env.OUTGOING_STREAM;
const uniqueId = crypto.randomUUID();
const LISTENER_GROUP =
  env.APP_STAGE === "dev"
    ? "backend-consumer-group"
    : `backend-consumer-group-${uniqueId}`;
const LISTENER_GROUP_CONSUMER = "worker-1";

export const setupComms = async () => {
  const promiseResolvers: Map<string, (value: TEngineResponseSchema) => void> =
    new Map();

  const listenerClient = await createClient({ url: env.REDIS_URL }).on(
    "error",
    (err) => console.log("Redis Client Error", err),
  );

  const senderClient = await createClient({ url: env.REDIS_URL }).on(
    "error",
    (err) => console.log("Redis Client Error", err),
  );

  await Promise.all([listenerClient.connect(), senderClient.connect()]);

  try {
    await listenerClient.xGroupCreate(INCOMING_STREAM, LISTENER_GROUP, "0", {
      MKSTREAM: true,
    });
  } catch (err: any) {
    if (!err.message.includes("BUSYGROUP")) {
      throw err;
    }
  }

  const handlePendingEntries = async () => {
    // handle PEL items - events that were picked up but not ACKed
    // think they can just be ack-ed or ignored, as the user would've already refreshed

    let start = "0-0";
    while (true) {
      const result = await listenerClient.xAutoClaim(
        INCOMING_STREAM,
        LISTENER_GROUP,
        LISTENER_GROUP_CONSUMER,
        1000, // idle ms
        start,
        {
          COUNT: 10, // batches of 10
        },
      );
      start = result.nextId;

      const messages =
        result.messages as unknown as TStreamEngineResponseMessage[];

      if (messages.length === 0) break;

      for (const message of messages) {
        if (!message) continue;

        await listenerClient.xAck(INCOMING_STREAM, LISTENER_GROUP, message.id);
      }
    }
  };

  const listenToIncomingEvents = async () => {
    while (true) {
      const response = (await listenerClient.xReadGroup(
        LISTENER_GROUP,
        LISTENER_GROUP_CONSUMER,
        [
          {
            key: INCOMING_STREAM,
            id: ">",
          },
        ],
        {
          BLOCK: 0,
          COUNT: 1,
        },
      )) as TStreamEngineResponse | null;

      if (!response || !Array.isArray(response)) {
        continue;
      }

      for (const stream of response) {
        for (const message of stream.messages) {
          const rawResult = RawEngineResponseSchema.safeParse(message.message);

          if (!rawResult.success) {
            console.error(
              "Unable to parse event1 - wrong structure:",
              message.id,
              message.message,
              rawResult.error,
            );
            await listenerClient.xAck(
              INCOMING_STREAM,
              LISTENER_GROUP,
              message.id,
            );
            continue;
          }

          const isOk = JSON.parse(rawResult.data.ok);
          const parsedMessage = {
            ...rawResult.data,
            ok: isOk,
            data: isOk ? JSON.parse(rawResult.data.data) : "",
          };

          const result = EngineResponseSchema.safeParse(parsedMessage);

          if (!result.success) {
            console.error(
              "Unable to parse event2 - wrong structure:",
              message.id,
              message.message,
              rawResult.error,
            );
            await listenerClient.xAck(
              INCOMING_STREAM,
              LISTENER_GROUP,
              message.id,
            );
            continue;
          }
          const { correlationId } = result.data;
          // resolve the promise, if available else short circuit
          promiseResolvers.get(correlationId)?.(result.data);

          await listenerClient.xAck(
            INCOMING_STREAM,
            LISTENER_GROUP,
            message.id,
          );
        }
      }
    }
  };

  const sendToEngineStream = async (
    type: TEngineSupportedTypes,
    payload: Record<string, unknown>,
  ) => {
    const correlationId = crypto.randomUUID();
    return new Promise<TEngineResponseSchema>(async (res, rej) => {
      promiseResolvers.set(correlationId, res);
      await senderClient.xAdd(OUTGOING_STREAM, "*", {
        correlationId,
        type,
        payload: JSON.stringify(payload),
      });
    });
  };

  return { handlePendingEntries, listenToIncomingEvents, sendToEngineStream };
};

export type TComms = Awaited<ReturnType<typeof setupComms>>;
