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
import { ServiceUnavailableError } from "../errors/custom-errors";
import {
  attachRedisLogging,
  redisClientOptions,
  runStreamLoop,
} from "@repo/shared/redis-resilience";
import { asTransportFailure } from "./transport-failure";

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

  const listenerClient = createClient(redisClientOptions(env.REDIS_URL));
  attachRedisLogging(listenerClient, "backend listener");

  const senderClient = createClient(redisClientOptions(env.REDIS_URL));
  attachRedisLogging(senderClient, "backend sender");

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

  /**
   * One batch. The loop, and its survival across a Redis outage, is
   * `runStreamLoop` — see D19 in the shared module.
   */
  const readOneBatch = async () => {
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
      return;
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
        if (correlationId) promiseResolvers.get(correlationId)?.(result.data);

        await listenerClient.xAck(
          INCOMING_STREAM,
          LISTENER_GROUP,
          message.id,
        );
      }
    }
  };

  const listenToIncomingEvents = () =>
    runStreamLoop("backend listener", readOneBatch);

  /**
   * Publishes a request to the engine and waits for the correlated reply.
   *
   * The previous version captured `rej` and never called it, and set no
   * timeout. So if the engine was down, had crashed mid-request, or produced a
   * reply the listener could not parse — the listener `xAck`s and `continue`s
   * on a parse failure, dropping it — the resolver stayed in the map forever
   * and the HTTP request hung until the client gave up. A spinner that never
   * resolves and never errors is worse than either outcome on its own.
   *
   * It also leaked: nothing removed a resolver from the map, including on the
   * success path, so the map grew by one entry per request for the life of the
   * process.
   */
  const sendToEngineStream = (
    type: TEngineSupportedTypes,
    payload: Record<string, unknown>,
  ) => {
    const correlationId = crypto.randomUUID();

    return new Promise<TEngineResponseSchema>((resolve, reject) => {
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        promiseResolvers.delete(correlationId);
        fn();
      };

      const timer = setTimeout(() => {
        settle(() =>
          reject(
            new ServiceUnavailableError(
              "The matching engine is not responding",
              "ENGINE_TIMEOUT",
            ),
          ),
        );
      }, env.ENGINE_TIMEOUT_MS);

      promiseResolvers.set(correlationId, (value) =>
        settle(() => resolve(value)),
      );

      senderClient
        .xAdd(OUTGOING_STREAM, "*", {
          correlationId,
          type,
          payload: JSON.stringify(payload),
        })
        .catch((err) => settle(() => reject(asTransportFailure(err))));
    });
  };

  /** Exposed for tests: proves the map does not grow across requests. */
  const pendingRequestCount = () => promiseResolvers.size;

  return {
    handlePendingEntries,
    listenToIncomingEvents,
    sendToEngineStream,
    pendingRequestCount,
  };
};

export type TComms = Awaited<ReturnType<typeof setupComms>>;
