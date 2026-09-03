import type { TEngineResponseSchema } from "@repo/shared/redis-events";
import env from "../env";
import type { WebSocketData } from "../types";
import { userTopic } from "./verify-ticket";

/**
 * The market-state trio, held for the next publish tick.
 *
 * All three are *levels*, not events: each says "here is how the market stands
 * now", so holding two and publishing the newer one loses nothing. That is
 * exactly what makes them safe to coalesce and prints unsafe — see below.
 */
type MarketState = {
  depth: unknown;
  lastTradedPrice: string | null;
  indexPrice: string | null;
};

export const createHandler = (
  server: Bun.Server<WebSocketData>,
  { intervalMs = env.MARKET_STATE_INTERVAL_MS }: { intervalMs?: number } = {},
) => {
  /**
   * Coalescing state, keyed by market.
   *
   * Per market and not global: a book being re-quoted must not hold up a quiet
   * one, and the cadence a subscriber sees should depend on the market they
   * subscribed to and nothing else.
   *
   * `timers` doubles as the "a window is open" flag. A market with no entry has
   * no window, which is why the first frame after a quiet spell publishes with
   * no added latency (see `publishMarketState`).
   */
  const pending = new Map<string, MarketState>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const publish = (marketId: string, state: MarketState) => {
    if (state.lastTradedPrice) {
      server.publish(
        `feed:${marketId}:last-traded-price`,
        JSON.stringify({
          feed: "last-traded-price",
          marketId,
          data: {
            price: state.lastTradedPrice,
          },
        }),
      );
    }

    if (state.indexPrice) {
      server.publish(
        `feed:${marketId}:mark-price`,
        JSON.stringify({
          feed: "mark-price",
          marketId,
          data: {
            price: state.indexPrice,
          },
        }),
      );
    }

    if (state.depth) {
      server.publish(
        `feed:${marketId}:depth`,
        JSON.stringify({
          feed: "depth",
          marketId,
          data: state.depth,
        }),
      );
    }
  };

  /**
   * The window closed.
   *
   * Nothing arrived during it → the window is dropped, so the market goes back
   * to publishing on arrival. Something did → publish the newest state and open
   * a fresh window, because traffic that filled one window will usually fill
   * the next. The chain therefore runs only while a market is actually busy and
   * stops on its own one interval after it goes quiet; there is no standing
   * timer per market.
   */
  const flush = (marketId: string) => {
    const state = pending.get(marketId);
    if (!state) {
      timers.delete(marketId);
      return;
    }
    pending.delete(marketId);
    publish(marketId, state);
    timers.set(
      marketId,
      setTimeout(() => flush(marketId), intervalMs),
    );
  };

  /**
   * Leading edge, then at most one publish per interval.
   *
   * The leading edge is the half that matters for a market nobody is churning:
   * a lone fill on a quiet book is on the wire immediately, and the cadence
   * only ever costs latency to the second and later frame inside a window —
   * which are, by construction, the ones a burst produced.
   */
  const publishMarketState = (marketId: string, state: MarketState) => {
    if (intervalMs <= 0) {
      publish(marketId, state);
      return;
    }
    if (timers.has(marketId)) {
      pending.set(marketId, state);
      return;
    }
    publish(marketId, state);
    timers.set(
      marketId,
      setTimeout(() => flush(marketId), intervalMs),
    );
  };

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

      /**
       * Prints.
       *
       * One message per trade rather than one per engine reply: a single
       * aggressive order can sweep several resting levels, and each of those is
       * a separate print at its own price — collapsing them would report a
       * sweep as one trade at one of the prices it crossed.
       *
       * Published IMMEDIATELY and never coalesced, which is the whole reason
       * the tape is handled separately from the trio below. A print is an event
       * that happened once; a book and a price are the current state of things.
       * Dropping a superseded book loses nothing, dropping a superseded print
       * loses a trade — so the two cannot share a policy however similar their
       * plumbing looks. The tape leads the state it caused, which is also the
       * order the two actually occur in.
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

      publishMarketState(marketId, {
        depth: update.depth,
        lastTradedPrice: update.lastTradedPrice ?? null,
        indexPrice: update.indexPrice ?? null,
      });
    }
  };

  return handler;
};
