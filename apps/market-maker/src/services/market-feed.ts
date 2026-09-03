import type { TMarketDepth } from "@repo/shared";

/**
 * The bot's view of the market, straight off `apps/ws-server`.
 *
 * **The anchor is the index price, not the last traded price.** `store.ts`
 * seeds each orderbook with a placeholder (BTC 5000, ETH 1900, SOL 90) and
 * nothing updates it until a trade crosses, so a bot that quoted off
 * `lastTradedPrice` would build its entire book around 5000 while the world
 * trades at 78,000 — and then the taker would print trades there, making the
 * wrong number look authoritative. `liqudationChecks` writes the Binance spot
 * price to `orderbook.indexPrice` on every tick and ws-server republishes it on
 * `feed:{marketId}:mark-price`; that is the only number here tied to reality.
 *
 * `depth` is cached from the same socket so the taker can size an order against
 * what is actually resting. It is a snapshot published on every engine reply,
 * not a delta stream, so there is no sequence number to track.
 *
 * One socket per market: `market_id` is fixed at the upgrade
 * (`createWSServer.ts`), and `message(ws)` is empty, so there is no
 * client→server protocol to subscribe to a second market on an open socket.
 */

export type MarketSnapshot = {
  indexPrice: number | null;
  lastTradedPrice: number | null;
  depth: TMarketDepth | null;
  /** Engine clock is irrelevant here; this is "when did we last hear anything". */
  indexPriceAt: number;
};

type FeedFrame = {
  feed?: string;
  data?: { price?: string } | TMarketDepth;
};

const RECONNECT_MS = 3_000;

export const createMarketFeed = ({
  wsUrl,
  marketIds,
}: {
  wsUrl: string;
  marketIds: string[];
}) => {
  const snapshots = new Map<string, MarketSnapshot>();
  const sockets = new Map<string, WebSocket>();
  let stopped = false;

  for (const marketId of marketIds) {
    snapshots.set(marketId, {
      indexPrice: null,
      lastTradedPrice: null,
      depth: null,
      indexPriceAt: 0,
    });
  }

  const connect = (marketId: string) => {
    if (stopped) return;

    const url = `${wsUrl}?feeds=mark-price,last-traded-price,depth&market_id=${marketId}`;
    const socket = new WebSocket(url);
    sockets.set(marketId, socket);

    socket.addEventListener("message", (event) => {
      let frame: FeedFrame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }

      const snapshot = snapshots.get(marketId);
      if (!snapshot || !frame.feed) return;

      if (frame.feed === "mark-price") {
        const price = Number((frame.data as { price?: string })?.price);
        if (Number.isFinite(price) && price > 0) {
          snapshot.indexPrice = price;
          snapshot.indexPriceAt = Date.now();
        }
      } else if (frame.feed === "last-traded-price") {
        const price = Number((frame.data as { price?: string })?.price);
        if (Number.isFinite(price) && price > 0) snapshot.lastTradedPrice = price;
      } else if (frame.feed === "depth") {
        snapshot.depth = frame.data as TMarketDepth;
      }
    });

    socket.addEventListener("error", () => {
      // `close` always follows, and that is where the reconnect lives.
    });

    socket.addEventListener("close", () => {
      sockets.delete(marketId);
      if (stopped) return;
      setTimeout(() => connect(marketId), RECONNECT_MS);
    });
  };

  return {
    start() {
      for (const marketId of marketIds) connect(marketId);
    },
    stop() {
      stopped = true;
      for (const socket of sockets.values()) socket.close();
      sockets.clear();
    },
    /**
     * The anchor, or `null` if it is too old to quote on.
     *
     * A stale anchor is the failure this service will actually hit, and it has
     * a specific cause worth naming in the log: `apps/price-poller` holds one
     * Binance socket and only recovers on a `close` event, so a socket that
     * goes silent without closing stalls the index feed indefinitely — the
     * engine then answers every `spot_price_update` with "Unsupported request
     * type" because the payload is `{"BTC":null}`.
     *
     * Refusing to quote is the right response rather than falling back to a
     * Binance poll of our own: an empty book is an honest demo failure, a book
     * full of confidently wrong prices is not.
     */
    anchor(marketId: string, staleMs: number) {
      const snapshot = snapshots.get(marketId);
      if (!snapshot?.indexPrice) return null;
      if (Date.now() - snapshot.indexPriceAt > staleMs) return null;
      return snapshot.indexPrice;
    },
    snapshot(marketId: string) {
      return snapshots.get(marketId) ?? null;
    },
  };
};

export type MarketFeed = ReturnType<typeof createMarketFeed>;
