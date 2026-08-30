import type { FillView, OrderRecord } from "@/lib/api/schemas";

/**
 * What the Order-history table shows that the `orders` row does not say.
 *
 * There is one real problem here and it is the price of a market order.
 *
 * `orders.price` is written by the BACKEND, from the client's payload, before
 * the engine has seen the order — and a market order's payload carries
 * `price: 0`, because the price is whatever the book gives. Nothing ever writes
 * the executed price back: `order_updates` carries only `status` and
 * `filledQty`. So the column holds a literal zero for every market order that
 * ever filled, and rendering it would put "0.00" in a price cell (G29). The
 * Open-orders tab could dismiss this as unreachable — a market order cannot
 * rest — but history is exactly where those orders end up.
 *
 * The executed price has to come from the fills, which is why the fill list and
 * the order list are loaded together. Same rule as `position-math.ts`: when the
 * answer is not known, the answer is `null`, and null renders as an em dash. A
 * zero in a price cell is a claim, and it is the wrong one.
 *
 * Pure and unit-tested for the same reason: the arithmetic is small and the
 * consequences of getting it wrong are not.
 */

/**
 * The statuses Order history shows.
 *
 * Terminal states only, so the tab does not duplicate Open orders — a row in
 * both places, one with a Cancel button and one without, reads as two orders.
 * `pending` is excluded too: the engine has not acknowledged it, so it is
 * neither resting nor finished, and the backend retires genuinely rejected ones
 * to `cancelled` (G28).
 */
export const HISTORY_STATUSES = ["filled", "cancelled"] as const;

export function isHistoricalOrder(
  order: Pick<OrderRecord, "status">,
): boolean {
  return (HISTORY_STATUSES as readonly string[]).includes(order.status);
}

/**
 * Volume-weighted average price of a set of fills.
 *
 * Weighted, not a plain mean: a market order that took 9 units at 95 and 1 at
 * 99 executed at 95.4, and the mean of the two prices — 97 — is a price the
 * order never traded at. The distinction is the whole reason this is a function
 * rather than a `.reduce` inline.
 *
 * Returns a STRING, because it is a price and prices are strings (CLAUDE.md).
 * `null` when there are no fills, or when their total size is zero — an order
 * that never executed has no execution price, and `0/0` is `NaN`.
 */
export function averageFillPrice(
  fills: readonly Pick<FillView, "price" | "qty">[],
): string | null {
  let notional = 0;
  let size = 0;

  for (const fill of fills) {
    const price = Number.parseFloat(fill.price);
    const qty = Number.parseFloat(fill.qty);
    // One unparseable fill makes the average unknowable rather than smaller.
    if (!Number.isFinite(price) || !Number.isFinite(qty)) return null;
    notional += price * qty;
    size += qty;
  }

  if (size <= 0) return null;
  return String(notional / size);
}

/** The account's fills, bucketed by the account's own order id. */
export function fillsByOrder(
  fills: readonly FillView[],
): Map<string, FillView[]> {
  const byOrder = new Map<string, FillView[]>();
  for (const fill of fills) {
    const bucket = byOrder.get(fill.orderId);
    if (bucket) bucket.push(fill);
    else byOrder.set(fill.orderId, [fill]);
  }
  return byOrder;
}

/**
 * The price to print for one historical order.
 *
 * - **limit** — its own limit price. That is a real number the user chose, and
 *   it is what they will be looking for; the average fill can differ from it
 *   (a resting bid can be lifted at a better price) but the order's identity is
 *   its limit.
 * - **market** — the volume-weighted average of its fills, or `null`. Never
 *   `orders.price`, which is 0.
 */
export function historyPrice(
  order: Pick<OrderRecord, "orderType" | "price">,
  fills: readonly Pick<FillView, "price" | "qty">[] = [],
): string | null {
  if (order.orderType === "limit") return order.price;
  return averageFillPrice(fills);
}
