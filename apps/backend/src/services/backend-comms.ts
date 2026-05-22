import { createClient } from "redis";
import env from "../env";
import {
  MessageSchema,
  RawMessageSchema,
  type TMessageSchema,
  type TStreamMessage,
  type TStreamResponse,
} from "../types/engine-types";

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
  const promiseResolvers: Map<string, (value: unknown) => void> = new Map();

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

      const messages = result.messages as unknown as TStreamMessage[];

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
      )) as TStreamResponse | null;

      if (!response || !Array.isArray(response)) {
        continue;
      }

      for (const stream of response) {
        for (const message of stream.messages) {
          const rawResult = RawMessageSchema.safeParse(message.message);

          if (!rawResult.success) {
            console.error(
              "Unable to parse event - wrong structure:",
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

          const parsedMessage = {
            ...rawResult.data,
            payload: JSON.parse(rawResult.data.payload),
          };

          const result = MessageSchema.safeParse(parsedMessage);

          if (!result.success) {
            console.error(
              "Unable to parse event - wrong structure:",
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
          console.log("messaged:", message.id, result.data);
          const { correlationId, payload } = result.data;
          promiseResolvers.get(correlationId)?.(payload);
          // td:: check if this backend has the correlationId set on the promises array, if not just ack it.

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
    type: "init_balance" | "create_order",
    engineRquest: unknown,
  ) => {
    const correlationId = crypto.randomUUID();
    return new Promise(async (res, rej) => {
      promiseResolvers.set(correlationId, res);
      await senderClient.xAdd(OUTGOING_STREAM, "*", {
        correlationId,
        type,
        payload: JSON.stringify(engineRquest),
      });
    });
  };

  return { handlePendingEntries, listenToIncomingEvents, sendToEngineStream };
};

export type TComms = Awaited<ReturnType<typeof setupComms>>;
