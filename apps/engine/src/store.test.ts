import { describe, expect, it } from "bun:test";
import { MARKETS, MARKET_LIST } from "@repo/db/markets";
import { createExchangeStore, type TStore } from "./store";

describe("createExchangeStore", () => {
  it("builds a fresh store when there is no snapshot", () => {
    // The cold-boot path: `loadStoreFromS3` returns null on any environment that
    // has never run the engine before, and the engine used to dereference it.
    const store = createExchangeStore(undefined);
    expect(store.lastUpdateId).toBe(0);
    expect(store.fills).toEqual([]);
    expect(Object.keys(store.orderbooks)).toHaveLength(MARKET_LIST.length);
  });

  it("builds a fresh store when the snapshot is explicitly null", () => {
    expect(createExchangeStore(null).lastUpdateId).toBe(0);
  });

  it("returns the snapshot untouched when one is supplied", () => {
    const snapshot = { ...createExchangeStore(), lastUpdateId: 99 } as TStore;
    expect(createExchangeStore(snapshot).lastUpdateId).toBe(99);
  });

  it("keys its orderbooks by the same UUIDs that seed the markets table", () => {
    // This is the assertion that keeps the engine, Postgres and the WebSocket
    // topics from drifting apart again.
    const store = createExchangeStore();
    for (const market of MARKET_LIST) {
      expect(store.orderbooks[market.id]).toBeDefined();
    }
    expect(store.supportedAssets).toEqual({
      SOL: MARKETS.SOL.id,
      ETH: MARKETS.ETH.id,
      BTC: MARKETS.BTC.id,
    });
  });

  it("gives every market a positive leverage cap and seed prices", () => {
    const store = createExchangeStore();
    for (const market of MARKET_LIST) {
      const book = store.orderbooks[market.id]!;
      expect(book.allowedLeverage).toBeGreaterThan(0);
      expect(book.lastTradedPrice).toBeGreaterThan(0);
      expect(book.indexPrice).toBeGreaterThan(0);
    }
  });
});
