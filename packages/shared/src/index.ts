import z from "zod";

export const CreateOrderSchema = z.discriminatedUnion("orderType", [
  z.object({
    orderType: z.literal("limit"),
    price: z.coerce.number().positive(),
    slippage: z.literal(0),
    qty: z.coerce.number().positive(),
    equity: z.coerce.number().positive().optional(),
    type: z.enum(["LONG", "SHORT"]),
    market: z.string().trim().min(1),
  }),
  z.object({
    orderType: z.literal("market"),
    price: z.literal(0),
    slippage: z.coerce.number().positive(),
    qty: z.coerce.number().positive(),
    equity: z.coerce.number().positive().optional(),
    type: z.enum(["LONG", "SHORT"]),
    market: z.string().trim().min(1),
  }),
]);

export type TCreateOrderSchema = z.infer<typeof CreateOrderSchema>;

/**
 * A market as served to clients by `GET /markets`.
 *
 * The frontend needs all of this to render a ticket correctly: `tickSize` drives
 * the NumericInput step, the decimals drive every price and size on screen, and
 * `maxLeverage` bounds the leverage slider. Serving it rather than hardcoding it
 * is what stops `apps/web/lib/markets.ts` inventing its own answer again.
 *
 * `tickSize` is a STRING. Every price-shaped value in this system is — see the
 * money rule in CLAUDE.md — and a tick size is a price increment.
 *
 * The nullable columns behind `priceDecimals`, `tickSize` and friends are
 * required here on purpose: a database that has not been seeded fails this
 * schema loudly instead of serving a plausible-looking wrong tick size.
 */
export const MarketDtoSchema = z.object({
  id: z.uuid(),
  slug: z.string().min(1),
  base: z.string().min(1),
  quote: z.string().min(1),
  priceDecimals: z.number().int().min(0),
  sizeDecimals: z.number().int().min(0),
  tickSize: z.string().min(1),
  maxLeverage: z.number().int().positive(),
  binanceSymbol: z.string().min(1),
  imageUrl: z.string().nullable(),
});
export type TMarketDto = z.infer<typeof MarketDtoSchema>;

export const MarketListSchema = z.object({ markets: z.array(MarketDtoSchema) });
export type TMarketListSchema = z.infer<typeof MarketListSchema>;

/**
 * The order-book depth snapshot.
 *
 * Defined here, in the dependency-free half of this package, rather than beside
 * the engine events where it started: `redis-events.ts` imports `@repo/db/schema`,
 * which pulls drizzle-orm and drizzle-zod behind it. Re-exporting from there
 * would have dragged the entire database layer into the browser bundle for the
 * sake of one zod object. `redis-events.ts` imports it back for `WsServerSchema`.
 *
 * Prices and quantities are `[price, qty]` STRING tuples, both over REST and
 * over the WebSocket — the same object is served by `GET /depth` and broadcast
 * on `feed:{marketId}:depth`.
 */
const PriceAsString = z.string();
const AvailableQtyAsString = z.string();
export const MarketDepthSchema = z.object({
  market: z.string(),
  lastUpdateId: z.coerce.number(),
  timestamp: z.coerce.number(),
  bids: z.array(z.tuple([PriceAsString, AvailableQtyAsString])),
  asks: z.array(z.tuple([PriceAsString, AvailableQtyAsString])),
});
export type TMarketDepth = z.infer<typeof MarketDepthSchema>;
