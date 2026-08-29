import { describe, expect, it } from "bun:test";
import { MARKETS, MARKET_LIST, MARKET_SYMBOLS } from "./markets";

describe("market identity", () => {
  it("defines exactly the three markets the engine trades", () => {
    expect(MARKET_SYMBOLS.sort()).toEqual(["BTC", "ETH", "SOL"]);
  });

  it("pins the UUIDs — these are foreign keys and WebSocket topics", () => {
    // Written out literally on purpose: this test exists to make a change to a
    // market id a deliberate, visible act rather than a silent one.
    expect(MARKETS.SOL.id).toBe("e3289213-372c-44d2-8cc8-2a6eb55b11b1");
    expect(MARKETS.ETH.id).toBe("13931aa2-9054-4e34-ac0f-4a8afad48226");
    expect(MARKETS.BTC.id).toBe("e59931c4-c54a-435f-8c57-382fa60fca58");
  });

  it("has unique ids and unique slugs", () => {
    const ids = MARKET_LIST.map((m) => m.id);
    const slugs = MARKET_LIST.map((m) => m.slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("keys every entry by its own symbol", () => {
    for (const [key, def] of Object.entries(MARKETS)) {
      expect(def.symbol).toBe(key as typeof def.symbol);
    }
  });
});
