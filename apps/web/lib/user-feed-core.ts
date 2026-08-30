import { z } from "zod";

/**
 * The private user channel, minus the I/O.
 *
 * Everything here is pure: parsing a frame off the socket, and the three
 * reducers that turn one event into new state for the Open-orders table, the
 * Positions table and the fill toasts. `user-feed.tsx` owns the socket, the
 * ticket, the timers and React.
 *
 * The split is the same one `market-feed-core.ts` makes, for the same reason —
 * but it matters more here. A depth frame is a full snapshot, so a client that
 * mishandles one is wrong for a second. These events are the only thing that
 * moves a row between "resting" and "filled", so a reducer that drops one is
 * wrong until something else refetches, which after this phase is nothing.
 *
 * **Every rule below is about applying an event that is out of date.** The
 * reconnect discipline is snapshot-then-drain (§7.3), so a buffered event that
 * the REST snapshot already reflects is replayed on purpose. That is safe only
 * because the engine's events are absolute rather than deltas, and because the
 * two that could still regress state — an order's status and its filled
 * quantity — are guarded by `supersedes`.
 */

/* ----------------------------------------------------------------- wire -- */

/**
 * The wire schema, restated rather than imported from `@repo/shared`.
 *
 * `redis-events.ts` reaches `@repo/db/schema` for the writer payload, which
 * would pull drizzle into the browser bundle for the sake of four object
 * shapes. `market-feed-core.ts` restates `TradePrintSchema` for the same
 * reason. The engine tests assert the emitted shape; these assert the parsed
 * one; the two meet at the field names.
 */
export const ORDER_STATUSES = [
  "pending",
  "open",
  "partially_filled",
  "filled",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses that belong on the Open-orders table — what `/orders/open` returns. */
const RESTING: ReadonlySet<string> = new Set(["open", "partially_filled"]);

export function isResting(status: string): boolean {
  return RESTING.has(status);
}

const UserOrderSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  positionType: z.enum(["LONG", "SHORT"]),
  orderType: z.enum(["market", "limit"]),
  status: z.enum(ORDER_STATUSES),
  qty: z.string(),
  filledQty: z.string(),
  price: z.string(),
  slippage: z.number(),
  initialMargin: z.string(),
  createdAt: z.string(),
});
export type UserOrder = z.infer<typeof UserOrderSchema>;

const UserPositionSchema = z.object({
  marketId: z.string(),
  type: z.enum(["LONG", "SHORT"]),
  qty: z.string(),
  margin: z.string(),
  averagePrice: z.string(),
  liquidationPrice: z.string(),
});
export type UserPosition = z.infer<typeof UserPositionSchema>;

export const UserEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("order.update"),
    orderId: z.string(),
    marketId: z.string(),
    status: z.enum(ORDER_STATUSES),
    filledQty: z.string(),
  }),
  z.object({
    type: z.literal("order.new"),
    order: UserOrderSchema,
    origin: z.enum(["user", "liquidation"]),
  }),
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
  z.object({
    type: z.literal("position"),
    marketId: z.string(),
    position: UserPositionSchema.nullable(),
  }),
  z.object({
    type: z.literal("balance"),
    available: z.string(),
    locked: z.string(),
  }),
]);
export type UserEvent = z.infer<typeof UserEventSchema>;

/**
 * One socket message → the batch of events it carried, or null.
 *
 * A batch, not an event: one aggressive order can sweep several levels, and
 * ws-server publishes what the engine addressed to this account in one message
 * precisely so the boundary survives. `groupFills` below is what that boundary
 * is for.
 *
 * Null covers the `{ type: "system" }` subscription acknowledgement and
 * anything malformed. **An unparseable frame must never tear the socket down**
 * — the connection is shared with the frames after it, and this one carries
 * the only notice an account gets that its order filled.
 *
 * Events are parsed individually and an unrecognised one is dropped rather
 * than failing the batch: a newer engine emitting a sixth event type must not
 * cost this client the five it understands.
 */
export function parseUserFrame(raw: string): UserEvent[] | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  if ((msg as { type?: unknown }).type === "system") return null;

  const envelope = msg as { feed?: unknown; data?: unknown };
  if (envelope.feed !== "user") return null;

  const shape = z
    .object({ data: z.object({ events: z.array(z.unknown()) }) })
    .safeParse(msg);
  if (!shape.success) return null;

  const events: UserEvent[] = [];
  for (const candidate of shape.data.data.events) {
    const parsed = UserEventSchema.safeParse(candidate);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

/* -------------------------------------------------------------- ordering -- */

/**
 * Whether an incoming order state is newer than the one we hold.
 *
 * This is the guard the plan asks for — "an event that predates the snapshot
 * is dropped" — and it is expressed as a property of the values rather than as
 * a sequence number, because there is no sequence number to have. The engine
 * emits per reply, ws-server publishes per topic, and the REST snapshot the
 * drain replays over comes from Postgres via db-writer, which is a different
 * clock entirely.
 *
 * Two rules, and both are facts about an order rather than conventions:
 *
 *   - **A terminal status is terminal.** `filled` and `cancelled` are the end
 *     of an order's life; nothing moves it back to `open`. A buffered event
 *     from before a refetch is the only way that could be attempted.
 *   - **Filled quantity never decreases.** It is a running total on the
 *     engine's own open order.
 *
 * Equal filled quantity is allowed through so a status-only transition —
 * `open` → `cancelled` — still applies.
 */
export function supersedes(
  held: { status: string; filledQty: string },
  incoming: { status: string; filledQty: string },
): boolean {
  if (!isResting(held.status)) return false;
  return Number(incoming.filledQty) >= Number(held.filledQty);
}

/* ------------------------------------------------------- open orders -- */

export type OpenOrderLike = {
  id: string;
  status: OrderStatus;
  filledQty: string;
};

/**
 * Applies one event to the resting-orders list.
 *
 * The list means exactly what `GET /orders/open` means — `open` and
 * `partially_filled`, nothing else — so an order that reaches a terminal state
 * leaves rather than being kept with a different badge. That equivalence is
 * what lets the REST snapshot and the push stream be the same list.
 *
 * `toRow` is supplied by the caller because a row needs its `Market` resolved,
 * and returning null from it is how an event for a market this build does not
 * know about is ignored — it cannot be rendered, and inventing a slug for it
 * would be worse than dropping it.
 *
 * An `order.update` for an id we do not hold is ignored, NOT inserted. The
 * update carries no price, quantity or side, so a row built from one would be
 * a row of blanks. The case is real and ordinary: an order that filled
 * instantly never rested, so its update is about an order that was never on
 * this list.
 */
export function reduceOpenOrders<T extends OpenOrderLike>(
  rows: readonly T[],
  event: UserEvent,
  toRow: (order: UserOrder) => T | null,
): T[] {
  switch (event.type) {
    case "order.new": {
      if (!isResting(event.order.status)) return rows as T[];
      const row = toRow(event.order);
      if (!row) return rows as T[];
      // Upsert: a redelivered batch must not double the row.
      const existing = rows.findIndex((r) => r.id === row.id);
      if (existing === -1) return [...rows, row];
      const next = [...rows];
      next[existing] = row;
      return next;
    }
    case "order.update": {
      const index = rows.findIndex((r) => r.id === event.orderId);
      if (index === -1) return rows as T[];

      const held = rows[index]!;
      if (!supersedes(held, event)) return rows as T[];

      if (!isResting(event.status)) {
        return rows.filter((r) => r.id !== event.orderId);
      }
      const next = [...rows];
      next[index] = { ...held, status: event.status, filledQty: event.filledQty };
      return next;
    }
    default:
      return rows as T[];
  }
}

/* --------------------------------------------------------------- positions -- */

/**
 * Applies one `position` event to the positions list.
 *
 * The event is absolute — the account's whole position in that market after
 * the reply, or `null` — so this is an upsert or a removal and never a merge.
 * `null` removing the row is the half that matters: omitting the event for a
 * closed position would be indistinguishable from "nothing happened", and the
 * row the user just closed would sit there until something refetched.
 *
 * One position per market is a guarantee of the engine's one-way netting, and
 * is why `marketId` is the key here and in the table.
 */
export function reducePositionEntries<T>(
  entries: readonly T[],
  event: UserEvent,
  {
    marketIdOf,
    toEntry,
  }: {
    /** The caller's row shape nests the position; this reads the key out of it. */
    marketIdOf: (entry: T) => string;
    toEntry: (position: UserPosition) => T | null;
  },
): T[] {
  if (event.type !== "position") return entries as T[];

  if (event.position === null) {
    return entries.filter((e) => marketIdOf(e) !== event.marketId);
  }

  const entry = toEntry(event.position);
  if (!entry) return entries as T[];

  const index = entries.findIndex((e) => marketIdOf(e) === event.marketId);
  if (index === -1) return [...entries, entry];
  const next = [...entries];
  next[index] = entry;
  return next;
}

/* ------------------------------------------------------------------ fills -- */

/**
 * The fills of one batch, collapsed to one row per order.
 *
 * A market order that sweeps three levels produces three fills at three
 * prices, and they are one trade from the trader's point of view. Three toasts
 * for one trade would be noise, and — worse — each would state a price that is
 * only part of what was paid.
 *
 * `price` is therefore the **quantity-weighted average**, which is the same
 * number `POST /order` returns as `averagePrice` and the same one the ticket
 * has always shown. It is computed in floating point and rendered back to a
 * string: the money rule (CLAUDE.md) is about not letting a float be the
 * *stored* representation, and an average of several prices does not exist as
 * a string anywhere upstream to be passed through instead.
 *
 * `seen` drops fills already applied. The reconnect drain replays events the
 * REST snapshot may already contain, and a toast is not idempotent the way a
 * row is — the user reads it once and it is gone.
 */
export type FillGroup = {
  orderId: string;
  marketId: string;
  side: "LONG" | "SHORT";
  /** `maker` if every fill in the group was; a sweep is always `taker`. */
  role: "maker" | "taker";
  qty: string;
  price: string;
  fillIds: string[];
  ts: number;
};

export function groupFills(
  events: readonly UserEvent[],
  seen: ReadonlySet<string> = new Set(),
): FillGroup[] {
  const groups = new Map<string, FillGroup & { notional: number; size: number }>();

  for (const event of events) {
    if (event.type !== "fill") continue;
    if (seen.has(event.fillId)) continue;

    const qty = Number(event.qty);
    const price = Number(event.price);
    // Both must be positive, not merely finite: `Number("")` is 0, and a
    // trade at a price or size of zero is not a trade.
    if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;
    if (qty <= 0 || price <= 0) continue;

    const existing = groups.get(event.orderId);
    if (!existing) {
      groups.set(event.orderId, {
        orderId: event.orderId,
        marketId: event.marketId,
        side: event.side,
        role: event.role,
        qty: event.qty,
        price: event.price,
        fillIds: [event.fillId],
        ts: event.ts,
        notional: qty * price,
        size: qty,
      });
      continue;
    }

    // A duplicate id inside one batch is applied once — the engine mints one
    // uuid per fill, so this is belt to the `seen` braces rather than a case
    // that should occur.
    if (existing.fillIds.includes(event.fillId)) continue;

    existing.fillIds.push(event.fillId);
    existing.notional += qty * price;
    existing.size += qty;
    existing.qty = `${existing.size}`;
    existing.price = `${existing.notional / existing.size}`;
    existing.ts = Math.max(existing.ts, event.ts);
  }

  return [...groups.values()].map(({ notional, size, ...group }) => group);
}

/**
 * The fill ids to remember, newest last, bounded.
 *
 * A session left open all day would otherwise grow a set with one entry per
 * fill forever. The bound is generous relative to what one connection can see
 * between reconnects, and the only cost of forgetting an id is a repeated
 * toast for a fill from thousands of trades ago.
 */
export const MAX_SEEN_FILLS = 500;

export function rememberFills(
  seen: ReadonlySet<string>,
  ids: readonly string[],
): Set<string> {
  const next = [...seen, ...ids];
  return new Set(next.slice(Math.max(0, next.length - MAX_SEEN_FILLS)));
}
