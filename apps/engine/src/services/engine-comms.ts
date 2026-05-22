import { createClient } from "redis";
import env from "../env";
import {
  MessageSchema,
  RawMessageSchema,
  type TMessageSchema,
  type TStreamMessage,
  type TStreamResponse,
} from "@repo/shared/redis-events";

// register with the redis stream
const INCOMING_STREAM = env.INCOMING_STREAM;
const OUTGOING_STREAM = env.OUTGOING_STREAM;
const LISTENER_GROUP = env.LISTENER_GROUP;
const LISTENER_GROUP_CONSUMER = env.LISTENER_GROUP_CONSUMER;

export const setupComms = async ({
  engineHandler,
}: {
  engineHandler: (message: Pick<TMessageSchema, "payload" | "type">) => void;
}) => {
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

        console.log("message:", message.id, result.data);

        const { correlationId, payload, type } = result.data;
        // resolving pending entries - there cud be a case where this entry might've been already processed by the engine and just before it cud ack it, the process crashed, as redis streams give capability of at-least once execution, not only once execution. maybe do idempotency by correlationId or message.id - td:: think more...
        const engineResponse = engineHandler({ payload, type });
        await sendToResponseStream(correlationId, engineResponse);

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

          // td:: send handler response back to senderClient
          const { correlationId, payload, type } = result.data;
          const engineResponse = engineHandler({ payload, type });
          await sendToResponseStream(correlationId, engineResponse);

          await listenerClient.xAck(
            INCOMING_STREAM,
            LISTENER_GROUP,
            message.id,
          );
        }
      }
    }
  };

  const sendToResponseStream = async (
    correlationId: string,
    engineResponse: unknown,
  ) => {
    await senderClient.xAdd(OUTGOING_STREAM, "*", {
      correlationId,
      payload: JSON.stringify(engineResponse),
    });
  };

  return { handlePendingEntries, listenToIncomingEvents };
};
