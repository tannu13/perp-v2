import type { TEngineResponseSchema } from "@repo/shared/redis-events";
import { createWSServer } from "./services/createWSServer";

const server = createWSServer();

const handler = (response: TEngineResponseSchema) => {
  if (typeof response.data === "string" && response.data === "") return;

  // response.data.
};

setInterval(() => {
  const update = {
    feed: "last-traded-price",
    timestamp: Date.now(),
    headline: "Hello",
  };
  console.log("Running update interval");

  server.publish(
    "feed:e3289213-372c-44d2-8cc8-2a6eb55b11b1:last-traded-price",
    JSON.stringify(update),
  );
}, 5000);
