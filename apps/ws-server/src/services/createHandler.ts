import type { TEngineResponseSchema } from "@repo/shared/redis-events";
import type { WebSocketData } from "../types";

export const createHandler = (server: Bun.Server<WebSocketData>) => {
  const handler = async (response: TEngineResponseSchema) => {
    if (typeof response.data === "string" && response.data === "") return;

    console.log("response.data.wsServer", response.data.wsServer);
    if (response.data?.wsServer) {
      const update = response.data.wsServer;
      const marketId = update.depth.market;

      if (update.lastTradedPrice) {
        server.publish(
          `feed:${marketId}:last-traded-price`,
          JSON.stringify({
            feed: "last-traded-price",
            marketId,
            data: {
              price: update.lastTradedPrice,
            },
          }),
        );
      }

      if (update.indexPrice) {
        server.publish(
          `feed:${marketId}:mark-price`,
          JSON.stringify({
            feed: "mark-price",
            marketId,
            data: {
              price: update.indexPrice,
            },
          }),
        );
      }

      if (update.depth) {
        server.publish(
          `feed:${marketId}:depth`,
          JSON.stringify({
            feed: "depth",
            marketId,
            data: update.depth,
          }),
        );
      }
    }
  };

  return handler;
};
