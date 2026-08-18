/**
 * STAND-IN for a missing backend endpoint.
 *
 * The `markets` table exists in packages/db (id, slug, imageUrl) but no route
 * serves it — apps/backend has no `GET /markets`. Every other order route takes
 * a `:marketId`, so the frontend needs this list to function at all.
 *
 * Replace the whole module with a fetch once that endpoint lands; nothing else
 * should need to change if the shape below is preserved.
 */
export type Market = {
  /** UUID from the markets table. Placeholder values until the endpoint exists. */
  id: string;
  /** URL segment and display symbol, e.g. SOL-USD. */
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

export const MARKETS: Market[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "SOL-USD",
    base: "SOL",
    quote: "USD",
    binanceSymbol: "SOLUSDT",
    priceDecimals: 2,
    sizeDecimals: 2,
    tickSize: 0.01,
    maxLeverage: 10,
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    slug: "BTC-USD",
    base: "BTC",
    quote: "USD",
    binanceSymbol: "BTCUSDT",
    priceDecimals: 1,
    sizeDecimals: 4,
    tickSize: 0.1,
    maxLeverage: 20,
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    slug: "ETH-USD",
    base: "ETH",
    quote: "USD",
    binanceSymbol: "ETHUSDT",
    priceDecimals: 2,
    sizeDecimals: 3,
    tickSize: 0.01,
    maxLeverage: 20,
  },
];

export const DEFAULT_MARKET = MARKETS[0]!;

export function marketBySlug(slug: string): Market | undefined {
  return MARKETS.find((m) => m.slug.toLowerCase() === slug.toLowerCase());
}
