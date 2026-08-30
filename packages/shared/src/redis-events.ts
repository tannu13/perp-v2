import { InsertFillSchema, InsertOrderSchema } from "@repo/db/schema";
import z from "zod";
import { MarketDepthSchema } from "./index";

export { MarketDepthSchema };

const EngineSupportedTypes = z.enum([
  "init_balance",
  "onramp",
  "create_order",
  "cancel_order",
  "get_balances",
  "get_open_positions_for_market",
  "get_closed_positions_for_market",
  "spot_price_update",
  "backup_store",
  "funding_rate_dispersal",
  "get_depth",
]);
export type TEngineSupportedTypes = z.infer<typeof EngineSupportedTypes>;

// engine requests
export const RawEngineRequestSchema = z.object({
  correlationId: z.string(),
  type: EngineSupportedTypes,
  payload: z.string(),
});
export type TRawEngineRequestSchema = z.infer<typeof RawEngineRequestSchema>;

export const EngineRequestSchema = z.object({
  correlationId: z.string(),
  type: EngineSupportedTypes,
  payload: z.record(z.string(), z.unknown()),
});
export type TEngineRequestSchema = z.infer<typeof EngineRequestSchema>;

export type TStreamEngineRequestMessage = {
  id: string;
  message: TEngineRequestSchema;
};
export type TStreamEngineRequest = {
  name: string;
  messages: TStreamEngineRequestMessage[];
}[];

// engine responses
export const RawEngineResponseSchema = z.object({
  correlationId: z.string(),
  ok: z.string(),
  data: z.string(),
  error: z.string(),
});
export type TRawEngineResponseSchema = z.infer<typeof RawEngineResponseSchema>;
export const OrderDataForWriterSchema = z.object({
  orderId: z.string(),
  userId: z.string(),
  status: z.string(),
  filledQty: z.coerce.number(),
});
export type TOrderDataForWriterSchema = z.infer<
  typeof OrderDataForWriterSchema
>;
export const WriterSchema = z.array(
  z.discriminatedUnion("table", [
    z.object({
      table: z.literal("fills"),
      data: z.array(InsertFillSchema),
    }),
    z.object({
      table: z.literal("order_updates"),
      data: z.array(OrderDataForWriterSchema),
    }),
    z.object({
      table: z.literal("order_inserts"),
      data: z.array(InsertOrderSchema),
    }),
  ]),
);
export type TWriterSchema = z.infer<typeof WriterSchema>;

/**
 * One public print.
 *
 * A `fills` row records a trade between two accounts; a print is what the rest
 * of the market is allowed to see of it. That difference is the whole schema:
 * **no user ids and no order ids**, because a public tape that carried them
 * would let anyone reconstruct who is positioned where from a socket that needs
 * no authentication at all.
 *
 * `side` is the **taker's** direction — the aggressor's, which is what a print
 * means everywhere else in the industry: "someone lifted the offer" is a buy.
 * The maker's side is the mirror image and carries no information.
 *
 * `id` is the same uuid the fill is persisted under, so a print and the row it
 * will become in the Fills tab are identifiably one trade. The engine mints it
 * at match time rather than letting Postgres default it — see `matchLongOrder`.
 *
 * `price` and `qty` are strings for the reason every other money field is
 * (CLAUDE.md): the engine holds numbers, Postgres holds strings, and the wire
 * is where that has to be settled once.
 */
export const TradePrintSchema = z.object({
  id: z.string(),
  price: z.string(),
  qty: z.string(),
  side: z.enum(["buy", "sell"]),
  /** Engine clock, milliseconds. When the match happened, not when it was written. */
  ts: z.number(),
});
export type TTradePrintSchema = z.infer<typeof TradePrintSchema>;

export const WsServerSchema = z.object({
  depth: MarketDepthSchema,
  lastTradedPrice: z.string(),
  indexPrice: z.string(),
  /**
   * The prints this engine reply produced, if any.
   *
   * Deliberately NOT derived by ws-server from `writer`'s `fills` entries, which
   * was the shape §6.13 first proposed. Two reasons. A fill row has no side —
   * it is one maker and one taker, and which of them was the aggressor is
   * known only inside the match function — so ws-server would have had to be
   * told anyway, and telling it by widening the *persistence* payload puts a
   * broadcast concern into the rows db-writer inserts. And `writer` also
   * carries fills from replies that must never be broadcast wholesale, so the
   * publisher would need a second rule to know which ones it may relay.
   *
   * Optional so a reply from an engine that predates this field still parses.
   */
  trades: z.array(TradePrintSchema).optional(),
});
export type TWsServerSchema = z.infer<typeof WsServerSchema>;
/* -------------------------------------------------------------------------- */
/*  The private user channel (Phase 13)                                        */
/* -------------------------------------------------------------------------- */

/**
 * One position, as the private channel reports it.
 *
 * The same fields `get_open_positions_for_market` answers with, as strings.
 * The client cannot derive this from a fill: netting, the weighted average
 * price and the liquidation price are all engine arithmetic, and a browser
 * recomputing them would be a second implementation of the risk model that
 * disagrees with the one that actually liquidates people.
 */
export const UserPositionSchema = z.object({
  marketId: z.string(),
  type: z.enum(["LONG", "SHORT"]),
  qty: z.string(),
  margin: z.string(),
  averagePrice: z.string(),
  liquidationPrice: z.string(),
});
export type TUserPositionSchema = z.infer<typeof UserPositionSchema>;

/**
 * The order row as the private channel reports it.
 *
 * Deliberately NOT `InsertOrderSchema`: that is a persistence shape with
 * optional columns and Date objects, and this has to survive `JSON.stringify`
 * through two processes and arrive parseable in a browser. Money is strings
 * for the reason every other money field is.
 */
export const UserOrderSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  positionType: z.enum(["LONG", "SHORT"]),
  orderType: z.enum(["market", "limit"]),
  status: z.string(),
  qty: z.string(),
  filledQty: z.string(),
  price: z.string(),
  slippage: z.number(),
  initialMargin: z.string(),
  createdAt: z.string(),
});
export type TUserOrderSchema = z.infer<typeof UserOrderSchema>;

/**
 * Everything that happens to ONE account, pushed rather than polled.
 *
 * This is the payload Phase 13 exists for (G19, G8). Until it existed the only
 * way a browser learned that a resting order had filled was to ask again, and
 * a maker — who by definition is not the one who submitted anything — had no
 * moment at which to ask.
 *
 * **The engine builds this, not ws-server.** §6.14 proposed having ws-server
 * re-derive ownership from the `writer` payload it already receives; that
 * payload is keyed by order and by fill, so "which users does this concern"
 * would have to be reconstructed from rows that do not carry the answer — a
 * fill names two accounts and says nothing about which side either was on, and
 * a position after netting is not in the writer payload at all. The engine
 * knows all of it without looking anything up, so it says it. ws-server stays
 * a fan-out that never inspects a payload it forwards.
 *
 * Every event is **idempotent by construction** — absolute values, never
 * deltas, and every one carries the identity it applies to. That is what makes
 * the reconnect discipline (snapshot, then drain the buffer) safe without a
 * sequence number: replaying an event the snapshot already contains changes
 * nothing.
 */
export const UserEventSchema = z.discriminatedUnion("type", [
  /**
   * An order this account owns changed state. Sent to a MAKER whose resting
   * order was hit — the case that is impossible to build without this channel.
   */
  z.object({
    type: z.literal("order.update"),
    orderId: z.string(),
    marketId: z.string(),
    status: z.string(),
    filledQty: z.string(),
  }),
  /**
   * An order this account owns came into existence, in its post-match state.
   *
   * §6.14 scoped this to liquidations — "this is how a liquidation order
   * reaches its owner". It is emitted for every order instead, because
   * `order.update` carries no price, quantity or side and so cannot produce a
   * row in the Open-orders table on its own. Without it the account that just
   * placed a resting order would still have to refetch to see it, which is the
   * exact refetch this phase is meant to delete.
   *
   * `origin` is what makes a liquidation legible: the account did not place it.
   */
  z.object({
    type: z.literal("order.new"),
    order: UserOrderSchema,
    origin: z.enum(["user", "liquidation"]),
  }),
  /**
   * A trade this account was part of, from ITS side.
   *
   * The public print (`TradePrintSchema`) carries the aggressor's side and no
   * identity; this carries the viewer's own side and its own order, which is
   * the same distinction `fill-view.ts` draws on the REST side. `role` is here
   * for the same reason it is there: a self-trade is reachable, and an account
   * on both sides of one trade gets two events.
   */
  z.object({
    type: z.literal("fill"),
    fillId: z.string(),
    orderId: z.string(),
    marketId: z.string(),
    side: z.enum(["LONG", "SHORT"]),
    role: z.enum(["maker", "taker"]),
    price: z.string(),
    qty: z.string(),
    ts: z.number(),
  }),
  /**
   * The account's position in one market after the reply, or `null` where it
   * has just been closed or netted flat. Absolute, never a delta.
   */
  z.object({
    type: z.literal("position"),
    marketId: z.string(),
    position: UserPositionSchema.nullable(),
  }),
  /** Collateral after the reply. Absolute; `equity` is the caller's sum. */
  z.object({
    type: z.literal("balance"),
    available: z.string(),
    locked: z.string(),
  }),
]);
export type TUserEventSchema = z.infer<typeof UserEventSchema>;

/**
 * userId → the events that reply produced for them.
 *
 * A batch rather than a flat list, and the batch boundary is load-bearing: one
 * aggressive order can sweep several resting levels and produce N fills against
 * one order, and a client that saw them one message at a time would raise N
 * toasts for one trade. The boundary is "what one engine reply did to you".
 */
export const WsUserSchema = z.record(z.string(), z.array(UserEventSchema));
export type TWsUserSchema = z.infer<typeof WsUserSchema>;

export const EngineResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    correlationId: z.string(),
    ok: z.literal(true),
    data: z.object({
      backend: z.record(z.string(), z.unknown()).nullable(),
      writer: WriterSchema.optional(),
      wsServer: WsServerSchema.optional(),
      /**
       * Per-account events, keyed by user id — the private channel's payload.
       *
       * Optional for the same reason `trades` is: a reply from an engine that
       * predates the field still parses, so a rolling deploy cannot take the
       * public feeds down while the two processes disagree.
       *
       */
      wsUser: WsUserSchema.optional(),
    }),
    error: z.literal(""),
  }),
  z.object({
    correlationId: z.string(),
    ok: z.literal(false),
    data: z.literal(""),
    error: z.string(),
  }),
]);
export type TEngineResponseSchema = z.infer<typeof EngineResponseSchema>;
export type TStreamEngineResponseMessage = {
  id: string;
  message: TEngineResponseSchema;
};
export type TStreamEngineResponse = {
  name: string;
  messages: TStreamEngineResponseMessage[];
}[];
