import { createClient } from "redis";
import env from "../env";
import {
  EngineRequestSchema,
  RawEngineRequestSchema,
  type TEngineRequestSchema,
  type TStreamEngineRequestMessage,
  type TStreamEngineRequest,
} from "@repo/shared/redis-events";
import type { TEngine, TEngineHandler } from "./exchange-engine";

// register with the redis stream
const INCOMING_STREAM = env.INCOMING_STREAM;
const OUTGOING_STREAM = env.OUTGOING_STREAM;
const LISTENER_GROUP = env.LISTENER_GROUP;
const LISTENER_GROUP_CONSUMER = env.LISTENER_GROUP_CONSUMER;

export const setupComms = async ({
  engineHandler,
}: {
  engineHandler: (message: TEngineHandler) => ReturnType<TEngine["handle"]>;
}) => {
  const recoveredMessageIds = new Map<string, boolean>();
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

  const runRecovery = async (startingMessageId: string) => {
    let startId = `(${startingMessageId}`;
    const endId = "+";

    while (true) {
      const entries = await listenerClient.xRange(
        INCOMING_STREAM,
        startId,
        endId,
        { COUNT: 100 },
      );

      if (entries.length === 0) break;

      for (const entry of entries) {
        const { id: messageId, message: messageObj } = entry;
        recoveredMessageIds.set(messageId, true);

        const rawResult = RawEngineRequestSchema.safeParse(messageObj);
        if (!rawResult.success) {
          continue;
        }

        const parsedMessage = {
          ...rawResult.data,
          payload: JSON.parse(rawResult.data.payload),
        };

        const result = EngineRequestSchema.safeParse(parsedMessage);
        if (!result.success) continue;

        const { type, payload } = result.data;

        try {
          engineHandler({ payload, type, messageId });
        } catch (err) {
          console.error(`Failed to replay historical event ${messageId}:`, err);
        }
      }

      const lastMessageInBatch = entries[entries.length - 1]!;
      startId = `(${lastMessageInBatch.id}`;
    }
  };

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

      const messages =
        result.messages as unknown as TStreamEngineRequestMessage[];

      if (messages.length === 0) break;

      for (const message of messages) {
        if (!message) continue;
        if (recoveredMessageIds.has(message.id)) {
          recoveredMessageIds.delete(message.id);
          await listenerClient.xAck(
            INCOMING_STREAM,
            LISTENER_GROUP,
            message.id,
          );
          continue;
        }

        const rawResult = RawEngineRequestSchema.safeParse(message.message);

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

        const result = EngineRequestSchema.safeParse(parsedMessage);

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

        const { correlationId, payload, type } = result.data;
        // resolving pending entries - there cud be a case where this entry might've been already processed by the engine and just before it cud ack it, the process crashed, as redis streams give capability of at-least once execution, not only once execution. maybe do idempotency by correlationId or message.id - td:: think more...
        try {
          const data = engineHandler({ payload, type, messageId: message.id });
          if (data) {
            await sendToResponseStream({
              correlationId,
              ok: true,
              data,
            });
          }
        } catch (err) {
          if (err instanceof Error) {
            await sendToResponseStream({
              correlationId,
              ok: false,
              error: err.message,
            });
          }
        }

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
      )) as TStreamEngineRequest | null;

      if (!response || !Array.isArray(response)) {
        continue;
      }

      for (const stream of response) {
        for (const message of stream.messages) {
          const rawResult = RawEngineRequestSchema.safeParse(message.message);

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

          const result = EngineRequestSchema.safeParse(parsedMessage);

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

          const { correlationId, payload, type } = result.data;
          try {
            const data = engineHandler({
              payload,
              type,
              messageId: message.id,
            });
            if (data) {
              await sendToResponseStream({
                correlationId,
                ok: true,
                data,
              });
            }
          } catch (err) {
            if (err instanceof Error) {
              await sendToResponseStream({
                correlationId,
                ok: false,
                error: err.message,
              });
            }
          }

          await listenerClient.xAck(
            INCOMING_STREAM,
            LISTENER_GROUP,
            message.id,
          );
        }
      }
    }
  };

  const sendToResponseStream = async ({
    correlationId,
    ok,
    data,
    error,
  }: {
    correlationId: string;
    ok: boolean;
    data?: unknown;
    error?: string;
  }) => {
    await senderClient.xAdd(OUTGOING_STREAM, "*", {
      correlationId,
      ok: JSON.stringify(ok),
      data: data ? JSON.stringify(data) : "",
      error: error ? error : "",
    });
  };

  return { handlePendingEntries, listenToIncomingEvents, runRecovery };
};
