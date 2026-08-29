import { describe, expect, it } from "bun:test";
import { MARKETS, MARKET_LIST } from "@repo/db/markets";
import { MarketDtoSchema } from "@repo/shared";
import { createExchangeStore } from "../../../engine/src/store";
import { createMarketService } from "./market-service";

/**
 * The market list, and the assertion that it agrees with the engine.
 *
 * `createExchangeStore` is imported directly from `apps/engine` — deliberately
 * reaching across an app boundary, because the whole point is to compare what
 * the API serves against what the matching engine will actually enforce. A test
 * that restated the expected leverage caps would pass happily while the two
 * drifted apart, which is exactly how G3 happened.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const service = createMarketService();
const engineStore = createExchangeStore();

describeDb("getMarkets", () => {
  it("serves exactly the seeded markets", async () => {
    const markets = await service.getMarkets();
    expect(markets).toHaveLength(MARKET_LIST.length);
    expect(markets.map((m) => m.slug).sort()).toEqual(
      MARKET_LIST.map((m) => m.slug).sort(),
    );
  });

  it("serves ids the engine actually keys its orderbooks by", async () => {
    const markets = await service.getMarkets();
    for (const market of markets) {
      expect(engineStore.orderbooks[market.id]).toBeDefined();
    }
  });

  it("serves the leverage cap the engine will enforce (G3)", async () => {
    // The engine rejects `(price * qty) / initialMargin > allowedLeverage`. If
    // this drifts, the leverage slider offers a value that produces an order the
    // engine refuses — after the user has confirmed it.
    const markets = await service.getMarkets();
    for (const market of markets) {
      const book = engineStore.orderbooks[market.id]!;
      expect(market.maxLeverage).toBe(book.allowedLeverage);
    }
  });

  it("agrees with the shared definition on every field", async () => {
    const markets = await service.getMarkets();
    for (const definition of MARKET_LIST) {
      const served = markets.find((m) => m.id === definition.id);
      expect(served).toBeDefined();
      expect(served!.slug).toBe(definition.slug);
      expect(served!.base).toBe(definition.base);
      expect(served!.quote).toBe(definition.quote);
      expect(served!.priceDecimals).toBe(definition.priceDecimals);
      expect(served!.sizeDecimals).toBe(definition.sizeDecimals);
      expect(served!.tickSize).toBe(definition.tickSize);
      expect(served!.maxLeverage).toBe(definition.maxLeverage);
      expect(served!.binanceSymbol).toBe(definition.binanceSymbol);
    }
  });

  it("returns a payload that parses against the published contract", async () => {
    const markets = await service.getMarkets();
    for (const market of markets) {
      expect(MarketDtoSchema.safeParse(market).success).toBe(true);
    }
  });

  it("keeps tickSize a string", async () => {
    // A price increment is money-shaped, and money is strings all the way
    // through — parsing it to a float here is how 0.1 becomes 0.09999999999.
    const markets = await service.getMarkets();
    for (const market of markets) {
      expect(typeof market.tickSize).toBe("string");
    }
  });

  it("gives BTC coarser price decimals than SOL", async () => {
    // A sanity check on the values themselves, not just their plumbing: a BTC
    // ladder quoted to two decimals would be unreadable.
    const markets = await service.getMarkets();
    const btc = markets.find((m) => m.id === MARKETS.BTC.id)!;
    const sol = markets.find((m) => m.id === MARKETS.SOL.id)!;
    expect(btc.priceDecimals).toBeLessThan(sol.priceDecimals);
    expect(btc.sizeDecimals).toBeGreaterThan(sol.sizeDecimals);
  });
});
