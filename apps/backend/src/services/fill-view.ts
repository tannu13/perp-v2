/**
 * A `fills` row, rewritten from one account's point of view.
 *
 * The table is a record of a TRADE, not of a participant: one row carries a
 * maker and a taker, and says nothing about which side either of them was on.
 * The Fill-history tab has to print "LONG" or "SHORT" for the person looking at
 * it, and — per CLAUDE.md — direction is never optional and never inferred from
 * colour alone. So the side has to be derived, and the derivation is
 * **per-viewer**: the same row is LONG/maker to one account and SHORT/taker to
 * the other. Getting it backwards tells someone they bought when they sold.
 *
 * That is why this file is pure and unit-tested rather than inlined into the
 * drizzle query: the arithmetic is trivial and the *attribution* is the risk.
 *
 * `qty`, `price` are varchar(80) in Postgres and stay strings all the way out —
 * money is strings (CLAUDE.md). `createdAt` becomes an ISO string because that
 * is what crosses the wire and what sorts correctly as text.
 */

export type PositionType = "LONG" | "SHORT";

/** The joined row this module consumes — the shape `db.query.fills` returns. */
export type JoinedFillRow = {
  id: string;
  marketId: string;
  makerId: string;
  takerId: string;
  makerOrderId: string;
  takerOrderId: string;
  qty: string;
  price: string;
  createdAt: Date;
  market: { slug: string } | null;
  makerOrder: { positionType: PositionType } | null;
  takerOrder: { positionType: PositionType } | null;
};

/** One account's participation in one fill. */
export type FillView = {
  /** The fill id. NOT unique in the response — see `fillViewsFor`. */
  id: string;
  marketId: string;
  /** Null only if the join found no market, which the FK makes impossible. */
  marketSlug: string | null;
  /** The viewer's own direction, from the viewer's own order. */
  side: PositionType;
  role: "maker" | "taker";
  /** The viewer's order this fill belongs to — how order history prices a
   *  market order, whose `orders.price` column is 0 (G29). */
  orderId: string;
  qty: string;
  price: string;
  createdAt: string;
};

/**
 * Every way `userId` took part in this fill, newest-agnostic.
 *
 * Usually one row. It returns an ARRAY because a self-trade — the account
 * crossing its own resting order — is reachable: the engine matches on price
 * alone and never checks that the two sides belong to different users. Such a
 * fill has the account on both sides, at opposite directions, and collapsing it
 * to one row would hide half of a trade the account actually made. `id` is
 * therefore not a unique key in the response; `id + role` is.
 *
 * An empty array means the fill is not the viewer's at all, which the query
 * already excludes — it is returned rather than thrown because a list read
 * should not be able to 500 on a row it can simply omit.
 */
export function fillViewsFor(row: JoinedFillRow, userId: string): FillView[] {
  const views: FillView[] = [];
  const base = {
    id: row.id,
    marketId: row.marketId,
    marketSlug: row.market?.slug ?? null,
    qty: row.qty,
    price: row.price,
    createdAt: row.createdAt.toISOString(),
  };

  /**
   * Maker first, so a self-trade reads maker-then-taker consistently rather
   * than in whatever order the object keys happened to be walked.
   */
  if (row.makerId === userId && row.makerOrder) {
    views.push({
      ...base,
      side: row.makerOrder.positionType,
      role: "maker",
      orderId: row.makerOrderId,
    });
  }
  if (row.takerId === userId && row.takerOrder) {
    views.push({
      ...base,
      side: row.takerOrder.positionType,
      role: "taker",
      orderId: row.takerOrderId,
    });
  }

  return views;
}

/**
 * The pagination cursor: `createdAt` alone is not enough.
 *
 * A market order sweeping three levels writes three fills inside the same
 * transaction, and `defaultNow()` gives them timestamps that can be equal to
 * the microsecond. A cursor of "everything older than T" would then either skip
 * the rest of that group or repeat it, depending on which side of the
 * comparison it fell — the exact gap-or-duplicate failure the pagination test
 * exists to catch. Pairing the timestamp with the row id makes the ordering
 * total, so `(createdAt, id) < (T, I)` is unambiguous.
 */
export function encodeFillCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

export function decodeFillCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  const separator = cursor.indexOf("|");
  if (separator < 0) return null;

  const createdAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;

  return { createdAt, id };
}
