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
import {
  attachRedisLogging,
  redisClientOptions,
  runStreamLoop,
} from "@repo/shared/redis-resilience";

// register with the redis stream
const RESPONSE_STREAM = env.ENGINE_RESPONSE_STREAM;

/**
 * One consumer group per process — the thing that lets this service scale.
 *
 * A consumer group *divides* a stream between its members. Two ws-servers
 * sharing `ws-server-group` would each be handed roughly half the engine
 * replies, so every browser would see half the depth frames, half the fills,
 * and a book that quietly disagrees with the engine. That is not a degraded
 * feed, it is a wrong one, and nothing in the protocol would report it.
 *
 * Fan-out is a group per reader. `apps/backend` reached the same conclusion for
 * the same reason (backend-comms.ts) — every replica must see every reply
 * because only one of them holds the caller waiting on it.
 *
 * Dev keeps the fixed name. `bun --watch` restarts on a keystroke, and a fresh
 * uuid each time would strand a group in Redis per save, each one holding the
 * offsets of a process that no longer exists.
 */
const uniqueId = crypto.randomUUID();
const LISTENER_GROUP =
  env.APP_STAGE === "dev"
    ? env.LISTENER_GROUP
    : `${env.LISTENER_GROUP}-${uniqueId}`;

/**
 * Fixed, and that is now correct rather than a shortcut.
 *
 * The old `td::` here wanted a dynamic consumer name to tell replicas apart.
 * With a group per process there is exactly one consumer in the group, so the
 * name has nothing left to disambiguate — the group name carries the identity.
 */
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
  const subscriber: RedisClientType = createClient(
    redisClientOptions(env.REDIS_URL),
  );
  attachRedisLogging(subscriber, "ws-server");

  await Promise.all([subscriber.connect()]);

  /**
   * `$` — a new group starts at the tail of the stream, not its head.
   *
   * This matters only because the group is now per process. Backend can create
   * its group at `0` because a replayed reply finds no waiting resolver and is
   * acked away; ws-server *publishes* whatever it reads. A group created at the
   * head would broadcast the entire retained stream on boot — up to
   * STREAM_MAXLEN, about an hour of depth frames at the market maker's rate —
   * as fast as it can read, to whoever connects during the catch-up. The book
   * would race through an hour of history and land on the truth, having shown
   * every intermediate state first.
   *
   * A market-data feed has no use for history. The first frame a client sees
   * should be the current book.
   *
   * BUSYGROUP is still tolerated: in dev the name is fixed, so the second boot
   * onwards finds the group already there and keeps its stored offset.
   */
  try {
    await subscriber.xGroupCreate(RESPONSE_STREAM, LISTENER_GROUP, "$", {
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

  const listenToIncomingClientEvents = <TRaw, TParsed>(
    label: string,
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
    /**
     * One batch. `runStreamLoop` owns the loop, so a dropped Redis socket
     * pauses this listener instead of ending the process (D19).
     */
    const readOneBatch = async () => {
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
        return;
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
              // The loop lives outside this function now, so `return` skips
              // this batch instead of ending the listener for good — which is
              // what "safe early return" always meant. Inside the old
              // `while (true)`, one duplicate stopped the service consuming
              // forever.
              return;
            }
            throw error;
          }

          await client.xAck(streamName, groupName, message.id);
        }
      }
    };

    return runStreamLoop(label, readOneBatch);
  };

  const listenToIncomingEvents = () => {
    listenToIncomingClientEvents("ws-server responses", {
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

  /**
   * Give the per-process group back to Redis on the way out.
   *
   * A group per replica means a group left behind per replica, and they do not
   * expire: a service redeployed weekly for a year leaves fifty-two dead groups
   * on the stream, each with its own pending-entries list, none of them ever
   * read again. Trimming does not collect them — MAXLEN drops entries, not
   * groups.
   *
   * Order matters. The listener is parked on `xReadGroup BLOCK 0`; destroying
   * the group underneath it answers NOGROUP, which is not a connection error,
   * so `runStreamLoop` would rightly refuse to swallow it and take the process
   * down on the way out of the door. So the socket is destroyed first — the
   * in-flight read then fails as a connection error, which the loop treats as a
   * pause — and the group is dropped over a second, short-lived client.
   *
   * Only graceful exits clean up. A `SIGKILL`ed or OOM-killed replica still
   * strands its group; this is a tidy-up, not a guarantee, and the counterpart
   * is worth having only because the common case is a rolling deploy.
   */
  const shutdown = async () => {
    if (env.APP_STAGE === "dev") return;

    try {
      subscriber.destroy();
    } catch {
      // Already gone. Nothing to do, and nothing that should stop the destroy.
    }

    const admin: RedisClientType = createClient(
      redisClientOptions(env.REDIS_URL),
    );
    attachRedisLogging(admin, "ws-server shutdown");

    try {
      await admin.connect();
      await admin.xGroupDestroy(RESPONSE_STREAM, LISTENER_GROUP);
      console.log(`[ws-server] released consumer group ${LISTENER_GROUP}`);
    } catch (err) {
      // A group we could not drop is litter, not a failure to exit over.
      console.warn(
        `[ws-server] could not release consumer group ${LISTENER_GROUP}:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      admin.destroy();
    }
  };

  return { handlePendingEntries, listenToIncomingEvents, shutdown };
};
