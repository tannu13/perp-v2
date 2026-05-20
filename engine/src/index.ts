import { createClient } from "redis";
import env from "./env";
import z from "zod";

const listenerClient = await createClient({ url: env.REDIS_URL }).on(
  "error",
  (err) => console.log("Redis Client Error", err),
);

await listenerClient.connect();

const senderClient = await createClient({ url: env.REDIS_URL }).on(
  "error",
  (err) => console.log("Redis Client Error", err),
);

await senderClient.connect();

// register with the redis stream
const STREAM = env.INCOMING_STREAM;
const LISTENER_GROUP = env.LISTENER_GROUP;
const LISTENER_GROUP_CONSUMER = env.LISTENER_GROUP_CONSUMER;

try {
  await listenerClient.xGroupCreate(STREAM, LISTENER_GROUP, "0", {
    MKSTREAM: true,
  });
  await senderClient.xGroupCreate(STREAM, LISTENER_GROUP, "0", {
    MKSTREAM: true,
  });
} catch (err: any) {
  if (!err.message.includes("BUSYGROUP")) {
    throw err;
  }
}

const RawMessageSchema = z.object({
  correlationId: z.string(),
  responseQueue: z.string(),
  type: z.enum(["init_balance", "create_order"]),
  payload: z.string(),
});

const MessageSchema = z.object({
  correlationId: z.string(),
  responseQueue: z.string(),
  type: z.enum(["init_balance", "create_order"]),
  payload: z.record(z.string(), z.unknown()),
});
type TMessageSchema = z.infer<typeof MessageSchema>;
type TStreamMessage = {
  id: string;
  message: TMessageSchema;
};
type TStreamResponse = {
  name: string;
  messages: TStreamMessage[];
}[];

// handle PEL items - events that were picked up but not ACKed
let start = "0-0";
while (true) {
  const result = await listenerClient.xAutoClaim(
    STREAM,
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
      await listenerClient.xAck(STREAM, LISTENER_GROUP, message.id);
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
      await listenerClient.xAck(STREAM, LISTENER_GROUP, message.id);
      continue;
    }

    console.log("message:", message.id, message.message);

    // td:: process message here

    await listenerClient.xAck(STREAM, LISTENER_GROUP, message.id);
  }
}

while (true) {
  const response = (await listenerClient.xReadGroup(
    LISTENER_GROUP,
    LISTENER_GROUP_CONSUMER,
    [
      {
        key: STREAM,
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
        await listenerClient.xAck(STREAM, LISTENER_GROUP, message.id);
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
        await listenerClient.xAck(STREAM, LISTENER_GROUP, message.id);
        continue;
      }
      console.log("messaged:", message.id, message.message);

      // td:: process message here

      await listenerClient.xAck(STREAM, LISTENER_GROUP, message.id);
    }
  }
}
