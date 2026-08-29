import { z } from "zod";
import { MarketDepthSchema, MarketListSchema } from "@repo/shared";

/**
 * Response contracts, and the one place money changes type.
 *
 * The backend is inconsistent about this and it is not the frontend's job to
 * cope downstream: rows read from Postgres carry `qty`, `price`, `filledQty`
 * and `initialMargin` as strings (varchar(80)), while the engine replies with
 * the same quantities as JavaScript numbers. Both arrive here; only strings
 * leave. See §3.2 and §7.7 of the integration plan, and the money rule in
 * CLAUDE.md.
 *
 * Shapes the server already publishes are imported from `@repo/shared` rather
 * than restated — `MarketListSchema` is literally the object the backend
 * validates its own response with.
 */

/**
 * Money, normalised to string at the boundary.
 *
 * `String(1e21)` is "1e+21" and `String(0.1+0.2)` is "0.30000000000000004", so
 * this is lossless-but-ugly in the extremes. That is the correct trade: the
 * alternative is parseFloat everywhere above, which is lossy in the middle.
 */
export const Money = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === "string" ? value : String(value)));

export { MarketDepthSchema, MarketListSchema };

/**
 * Identity only. The backend deliberately does NOT return the token — it goes
 * straight into an httpOnly cookie, and a token in a response body is a token
 * in browser JavaScript.
 */
export const AuthResultSchema = z.object({
  userId: z.string(),
  username: z.string(),
});
export type AuthResult = z.infer<typeof AuthResultSchema>;

export const SignoutResultSchema = z.object({ ok: z.boolean() });

export const BalancesSchema = z.object({
  balances: z.object({
    available: Money,
    locked: Money,
  }),
});
export type Balances = z.infer<typeof BalancesSchema>;

export const OnrampResultSchema = z.object({
  userId: z.string(),
  available: Money,
});

/** Mirrors the `orders` row: every money column is already a string. */
export const OrderRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  marketId: z.string(),
  positionType: z.enum(["LONG", "SHORT"]),
  orderType: z.enum(["market", "limit"]),
  status: z.enum([
    "pending",
    "open",
    "partially_filled",
    "filled",
    "cancelled",
  ]),
  qty: Money,
  filledQty: Money,
  price: Money,
  slippage: z.number(),
  initialMargin: Money,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OrderRecord = z.infer<typeof OrderRecordSchema>;

export const OrdersSchema = z.object({ orders: z.array(OrderRecordSchema) });

/** A fill as the engine reports it inside a `POST /order` reply. */
export const EngineFillSchema = z.object({
  makerId: z.string(),
  takerId: z.string(),
  marketId: z.string(),
  qty: Money,
  price: Money,
  makerOrderId: z.string(),
  takerOrderId: z.string(),
});

export const CreateOrderResultSchema = z.object({
  orderId: z.string(),
  status: z.enum([
    "pending",
    "open",
    "partially_filled",
    "filled",
    "cancelled",
  ]),
  filledQty: Money,
  totalPrice: Money,
  averagePrice: Money,
  fills: z.array(EngineFillSchema),
});
export type CreateOrderResult = z.infer<typeof CreateOrderResultSchema>;

export const CancelOrderResultSchema = z.object({
  order: OrderRecordSchema,
  cancelledQty: Money,
  balances: z.object({
    releasedMargin: Money,
    available: Money,
    locked: Money,
  }),
});
export type CancelOrderResult = z.infer<typeof CancelOrderResultSchema>;

/**
 * A position, straight from engine memory.
 *
 * `pnL` is optional and is NOT a live value — the engine only writes it during
 * position netting. Phase 9 derives unrealised PnL client-side from
 * `averagePrice`, `qty` and the live last-traded price. See G12.
 */
export const PositionSchema = z.object({
  marketId: z.string(),
  type: z.enum(["LONG", "SHORT"]),
  qty: Money,
  margin: Money,
  liquidationPrice: Money,
  averagePrice: Money,
  pnL: Money.optional(),
});
export type Position = z.infer<typeof PositionSchema>;

export const OpenPositionsSchema = z.object({
  positions: z.array(PositionSchema),
});

export const ClosedPositionsSchema = z.object({
  closedPositions: z.array(
    PositionSchema.extend({ exitType: z.enum(["MANUAL", "LIQUIDATED"]) }),
  ),
});

/** A `fills` row. No `side` and no fee — see G11; both are Phase 10 problems. */
export const FillRecordSchema = z.object({
  id: z.string(),
  makerId: z.string(),
  takerId: z.string(),
  marketId: z.string(),
  qty: Money,
  price: Money,
  makerOrderId: z.string(),
  takerOrderId: z.string(),
  createdAt: z.string(),
});
export type FillRecord = z.infer<typeof FillRecordSchema>;

export const FillsSchema = z.object({ fills: z.array(FillRecordSchema) });
