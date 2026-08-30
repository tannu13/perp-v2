import type { TEngineResponseSchema } from "@repo/shared/redis-events";
import type { WebSocketData } from "../types";
import { userTopic } from "./verify-ticket";

export const createHandler = (server: Bun.Server<WebSocketData>) => {
  const handler = async (response: TEngineResponseSchema) => {
    if (typeof response.data === "string" && response.data === "") return;

    /**
     * The private channel (Phase 13).
     *
     * Published FIRST, before the public feeds. Both describe the same trade,
     * and if the two crossed on the wire an account could see the book move
     * before it was told the fill that moved it — a maker watching their own
     * level disappear a frame before being told it filled. Ordering them costs
     * nothing and removes the question.
     *
     * ws-server does not read inside these events, and that is the design.
     * §6.14 proposed re-deriving ownership here from the `writer` payload;
     * the engine emits `wsUser` keyed by user id instead, so the fan-out is a
     * loop over topics and the knowledge of who a fill belongs to stays in the
     * one process that has the position state to know. The same reasoning that
     * put print-anonymisation in the engine in Phase 12 (a broadcaster should
     * not be trusted to remember a privacy rule) applies from the other side:
     * a broadcaster should not be trusted to *derive* an addressee.
     *
     * One message per user per engine reply — the batch boundary is
     * load-bearing, see `WsUserSchema`.
     */
    if (response.data?.wsUser) {
      for (const [userId, events] of Object.entries(response.data.wsUser)) {
        if (!events.length) continue;
        server.publish(
          userTopic(userId),
          JSON.stringify({ feed: "user", data: { events } }),
        );
      }
    }

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

      /**
       * Prints.
       *
       * One message per trade rather than one per engine reply: a single
       * aggressive order can sweep several resting levels, and each of those is
       * a separate print at its own price — collapsing them would report a
       * sweep as one trade at one of the prices it crossed.
       *
       * The payload is relayed exactly as the engine built it (§4.2). Nothing
       * is looked up and nothing is added, which is what keeps the guarantee
       * that a print carries no account or order identity: this socket needs no
       * authentication, so anything published here is public by construction.
       */
      if (update.trades?.length) {
        for (const trade of update.trades) {
          server.publish(
            `feed:${marketId}:trades`,
            JSON.stringify({
              feed: "trades",
              marketId,
              data: trade,
            }),
          );
        }
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
