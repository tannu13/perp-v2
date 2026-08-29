/**
 * Market identity — the single source of truth for what a market *is*.
 *
 * Three places used to invent their own answer: the engine hardcoded UUIDs in
 * `SUPPORTED_ASSETS`, the `markets` table was populated by hand with different
 * slugs, and `apps/web/lib/markets.ts` made up a third set. `POST /order`
 * resolves a market by slug against the table while every other route takes the
 * UUID, so any drift between the three is an order that 404s and a WebSocket
 * topic nothing publishes to.
 *
 * This module lives in `@repo/db` rather than `@repo/shared` because the seed
 * script needs it and `@repo/shared` already depends on `@repo/db` — the other
 * direction would be a cycle.
 *
 * The UUIDs are load-bearing and must never change: they are the primary keys
 * in `markets`, the foreign keys in `orders` and `fills`, the engine's
 * orderbook keys, and the `market_id` in every `feed:{marketId}:{feed}`
 * WebSocket topic.
 */

export type MarketSymbol = "SOL" | "ETH" | "BTC";

export type MarketDefinition = {
  symbol: MarketSymbol;
  /** Primary key of the `markets` row and the engine's orderbook key. */
  id: string;
  /** URL segment, display symbol, and the `market` field of CreateOrderSchema. */
  slug: string;
  base: string;
  quote: string;
  /** Decimal places for price and size display. */
  priceDecimals: number;
  sizeDecimals: number;
  /**
   * Smallest price increment. A string, like every other money value in this
   * system — see the money rule in CLAUDE.md.
   */
  tickSize: string;
  /**
   * Maximum leverage the engine will accept for this market.
   *
   * The engine rejects an order whose `(price * qty) / initialMargin` exceeds
   * this, so a UI that offers a higher figure produces orders that are accepted
   * by the form and refused by the engine. `apps/engine/src/store.ts` reads this
   * value rather than restating it, which is what makes that class of mismatch
   * impossible rather than merely unlikely.
   */
  maxLeverage: number;
  /** Only used for the chart's index-price fallback. */
  binanceSymbol: string;
};

export const MARKETS: Record<MarketSymbol, MarketDefinition> = {
  SOL: {
    symbol: "SOL",
    id: "e3289213-372c-44d2-8cc8-2a6eb55b11b1",
    slug: "SOL-USD",
    base: "SOL",
    quote: "USD",
    priceDecimals: 2,
    sizeDecimals: 2,
    tickSize: "0.01",
    maxLeverage: 30,
    binanceSymbol: "SOLUSDT",
  },
  ETH: {
    symbol: "ETH",
    id: "13931aa2-9054-4e34-ac0f-4a8afad48226",
    slug: "ETH-USD",
    base: "ETH",
    quote: "USD",
    priceDecimals: 2,
    sizeDecimals: 3,
    tickSize: "0.01",
    maxLeverage: 3,
    binanceSymbol: "ETHUSDT",
  },
  BTC: {
    symbol: "BTC",
    id: "e59931c4-c54a-435f-8c57-382fa60fca58",
    slug: "BTC-USD",
    base: "BTC",
    quote: "USD",
    priceDecimals: 1,
    sizeDecimals: 4,
    tickSize: "0.1",
    maxLeverage: 8,
    binanceSymbol: "BTCUSDT",
  },
};

export const MARKET_LIST: MarketDefinition[] = Object.values(MARKETS);

export const MARKET_SYMBOLS: MarketSymbol[] = Object.keys(
  MARKETS,
) as MarketSymbol[];
