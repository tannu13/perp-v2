import { createClient, type RedisClientType } from "redis";
import {
  EngineRequestSchema,
  RawEngineRequestSchema,
  type TEngineRequestSchema,
  type TStreamEngineRequestMessage,
  type TStreamEngineRequest,
  RawEngineResponseSchema,
  EngineResponseSchema,
  type TEngineResponseSchema,
} from "@repo/shared/redis-events";
import type { ZodType } from "zod";
import env from "../env";

// register with the redis stream
const RESPONSE_STREAM = env.ENGINE_RESPONSE_STREAM;
const LISTENER_GROUP = env.LISTENER_GROUP;
// td:: consumer name could be dynamic -- add that logic
const LISTENER_GROUP_CONSUMER = env.LISTENER_GROUP_CONSUMER;

interface StreamProcessorConfig<TRaw, TParsed> {
  client: RedisClientType;
  streamName: string;
  groupName: string;
  consumerName: string;
  rawSchema: ZodType<TRaw>;
  finalSchema: ZodType<TParsed>;
  transformRaw: (raw: TRaw) => any;
  handler: (data: TParsed) => Promise<void>;
}

export const setupComms = async ({
  responseHandler,
}: {
  responseHandler: (data: TEngineResponseSchema) => Promise<void>;
}) => {
  const subscriber: RedisClientType = createClient({
    url: env.REDIS_URL,
  });
  subscriber.on("error", (err) => {
    console.log("Redis Client Error", err);
  });

  await Promise.all([subscriber.connect()]);

  try {
    await subscriber.xGroupCreate(RESPONSE_STREAM, LISTENER_GROUP, "0", {
      MKSTREAM: true,
    });
  } catch (err: any) {
    if (!err.message.includes("BUSYGROUP")) {
      throw err;
    }
  }

  const handlePendingClientEntries = async <TRaw, TParsed>(
    config: StreamProcessorConfig<TRaw, TParsed>,
  ) => {
    const {
      client,
      streamName,
      groupName,
      consumerName,
      rawSchema,
      finalSchema,
      transformRaw,
      handler,
    } = config;
    // handle PEL items - events that were picked up but not ACKed
    let start = "0-0";
    while (true) {
      const result = await client.xAutoClaim(
        streamName,
        groupName,
        consumerName,
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

        const rawResult = rawSchema.safeParse(message.message);

        if (!rawResult.success) {
          console.error(
            "Unable to parse event1 - wrong structure:",
            message.id,
            message.message,
            rawResult.error,
          );
          await client.xAck(streamName, groupName, message.id);
          continue;
        }

        const parsedMessage = transformRaw(rawResult.data);

        const result = finalSchema.safeParse(parsedMessage);

        if (!result.success) {
          console.error(
            "Unable to parse event2 - wrong structure:",
            message.id,
            message.message,
            result.error,
          );
          await client.xAck(streamName, groupName, message.id);
          continue;
        }

        // resolving pending entries - there cud be a case where this entry might've been already processed by the engine and just before it cud ack it, the process crashed, as redis streams give capability of at-least once execution, not only once execution. maybe do idempotency by correlationId or message.id - implemented idempotency by correlationId
        try {
          await handler(result.data);
        } catch (error: any) {
          // td:: handle db write error here
          const code = error?.code ?? error?.cause?.code;
          if (code === "23505") {
            console.log("Duplicate event skipped");
            await client.xAck(streamName, groupName, message.id);
            continue;
          }
          throw error;
        }

        await client.xAck(streamName, groupName, message.id);
      }
    }
  };

  const handlePendingEntries = async () => {
    await handlePendingClientEntries({
      client: subscriber,
      streamName: RESPONSE_STREAM,
      groupName: LISTENER_GROUP,
      consumerName: LISTENER_GROUP_CONSUMER,
      rawSchema: RawEngineResponseSchema,
      finalSchema: EngineResponseSchema,
      transformRaw: (raw) => {
        const isOk = JSON.parse(raw.ok) as boolean;
        return {
          ...raw,
          ok: isOk,
          data: isOk ? JSON.parse(raw.data) : undefined,
        };
      },
      handler: (data) => responseHandler(data),
    });
  };

  const listenToIncomingClientEvents = async <TRaw, TParsed>(
    config: StreamProcessorConfig<TRaw, TParsed>,
  ) => {
    const {
      client,
      streamName,
      groupName,
      consumerName,
      rawSchema,
      finalSchema,
      transformRaw,
      handler,
    } = config;
    while (true) {
      const response = (await client.xReadGroup(
        groupName,
        consumerName,
        [
          {
            key: streamName,
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
          const rawResult = rawSchema.safeParse(message.message);

          if (!rawResult.success) {
            console.error(
              "Unable to parse event3 - wrong structure:",
              message.id,
              message.message,
              rawResult.error,
            );
            await client.xAck(streamName, groupName, message.id);
            continue;
          }

          const parsedMessage = transformRaw(rawResult.data);

          const result = finalSchema.safeParse(parsedMessage);

          if (!result.success) {
            console.error(
              "Unable to parse event4 - wrong structure:",
              message.id,
              message.message,
              result.error,
              parsedMessage,
            );
            await client.xAck(streamName, groupName, message.id);
            continue;
          }

          try {
            await handler(result.data);
          } catch (error: any) {
            // td:: handle db write error here
            const code = error?.code ?? error?.cause?.code;
            if (code === "23505") {
              console.log("Duplicate event skipped");
              return; // Safe early return, data was already rolled back!
            }
            throw error;
          }

          await client.xAck(streamName, groupName, message.id);
        }
      }
    }
  };

  const listenToIncomingEvents = async () => {
    listenToIncomingClientEvents({
      client: subscriber,
      streamName: RESPONSE_STREAM,
      groupName: LISTENER_GROUP,
      consumerName: LISTENER_GROUP_CONSUMER,
      rawSchema: RawEngineResponseSchema,
      finalSchema: EngineResponseSchema,
      transformRaw: (raw) => {
        const isOk = JSON.parse(raw.ok) as boolean;
        return {
          ...raw,
          ok: isOk,
          data: isOk ? JSON.parse(raw.data) : undefined,
        };
      },
      handler: (data) => responseHandler(data),
    });
  };

  return { handlePendingEntries, listenToIncomingEvents };
};
