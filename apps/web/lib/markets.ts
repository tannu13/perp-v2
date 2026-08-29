import { getMarkets } from "./api/endpoints";
import type { TMarketDto } from "@repo/shared";

/**
 * Markets.
 *
 * `GET /markets` exists as of Phase 2 and `fetchMarkets()` below is the real
 * source. The static `MARKETS` array is kept because the terminal's client
 * components still import it directly, and moving them onto props is a
 * component change that belongs to the phases that touch those files.
 *
 * The static values are no longer invented: they are the same three UUIDs,
 * decimals and leverage caps that `packages/db/src/markets.ts` seeds and the
 * engine keys its orderbooks by. The old placeholders (`00000000-…-0001`, and
 * maxLeverage of 10/20/20 against the engine's 30/3/8) meant the WebSocket
 * subscribed to a topic nothing published to and the leverage slider offered
 * values the engine rejects.
 */
export type Market = {
  /** UUID from the markets table. Also the engine's orderbook key and the
   *  `market_id` in every `feed:{marketId}:{feed}` WebSocket topic. */
  id: string;
  /** URL segment, display symbol, and the `market` field of CreateOrderSchema. */
  slug: string;
  base: string;
  quote: string;
  /** Binance symbol, used only for the candle fallback. */
  binanceSymbol: string;
  /** Decimal places for price and size display. */
  priceDecimals: number;
  sizeDecimals: number;
  /** Smallest price increment — drives the NumericInput step. */
  tickSize: number;
  maxLeverage: number;
};

/**
 * Maps the wire DTO onto the shape the components already consume.
 *
 * `tickSize` is a string on the wire, as every price-shaped value is, and
 * becomes a number here because its only consumer is an `<input step>` — a UI
 * increment, not a value that is ever stored or sent back.
 */
export function marketFromDto(dto: TMarketDto): Market {
  return {
    id: dto.id,
    slug: dto.slug,
    base: dto.base,
    quote: dto.quote,
    binanceSymbol: dto.binanceSymbol,
    priceDecimals: dto.priceDecimals,
    sizeDecimals: dto.sizeDecimals,
    tickSize: Number(dto.tickSize),
    maxLeverage: dto.maxLeverage,
  };
}

/** The real source. Call it on the server and pass `Market` down as a prop. */
export async function fetchMarkets(): Promise<Market[]> {
  const dtos = await getMarkets();
  return dtos.map(marketFromDto);
}

export async function fetchMarketBySlug(
  slug: string,
): Promise<Market | undefined> {
  const markets = await fetchMarkets();
  return markets.find((m) => m.slug.toLowerCase() === slug.toLowerCase());
}

/**
 * Build-time / client-side fallback, kept in step with the seed by
 * `markets.test.ts`. Consumers move to `fetchMarkets()` as their phases land.
 */
export const MARKETS: Market[] = [
  {
    id: "e3289213-372c-44d2-8cc8-2a6eb55b11b1",
    slug: "SOL-USD",
    base: "SOL",
    quote: "USD",
    binanceSymbol: "SOLUSDT",
    priceDecimals: 2,
    sizeDecimals: 2,
    tickSize: 0.01,
    maxLeverage: 30,
  },
  {
    id: "e59931c4-c54a-435f-8c57-382fa60fca58",
    slug: "BTC-USD",
    base: "BTC",
    quote: "USD",
    binanceSymbol: "BTCUSDT",
    priceDecimals: 1,
    sizeDecimals: 4,
    tickSize: 0.1,
    maxLeverage: 8,
  },
  {
    id: "13931aa2-9054-4e34-ac0f-4a8afad48226",
    slug: "ETH-USD",
    base: "ETH",
    quote: "USD",
    binanceSymbol: "ETHUSDT",
    priceDecimals: 2,
    sizeDecimals: 3,
    tickSize: 0.01,
    maxLeverage: 3,
  },
];

export const DEFAULT_MARKET = MARKETS[0]!;

export function marketBySlug(slug: string): Market | undefined {
  return MARKETS.find((m) => m.slug.toLowerCase() === slug.toLowerCase());
}
