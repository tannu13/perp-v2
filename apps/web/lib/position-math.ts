import type { Position } from "@/lib/api/schemas";
import type { TMarketDepth } from "@repo/shared";

/**
 * Everything the Positions table shows that the server does not send.
 *
 * The engine's `TPosition` carries `marketId`, `type`, `qty`, `margin`,
 * `averagePrice` and `liquidationPrice`. Mark, unrealised PnL, ROE and leverage
 * are all absent — and `pnL`, the one field that looks like it fills the gap,
 * **is not a live value**: `updateUnrealisedPnLForAllUsers` only runs on a trade
 * in that market, so a position's `pnL` is whatever the price was the last time
 * somebody else traded. Rendering it would show a number that is stale by an
 * unknown and unbounded amount, with nothing on screen saying so. That is G12.
 *
 * So the four derived columns are computed here instead, from the mark, and
 * this file is pure and unit-tested because the arithmetic *is* the risk: a
 * sign error in `unrealisedPnl` tells someone they are up when they are down.
 *
 * **On floats.** Money is strings everywhere else (CLAUDE.md) and stays strings
 * on the way in — `Position.qty` is a string, and so is `mark`. These return
 * `number`, which is correct precisely because nothing here is ever stored or
 * sent back: a PnL is a display quantity derived from a price nobody promised,
 * and `Delta` takes a number. The strings are the record; these are the read.
 *
 * **On null.** Every function returns `null` rather than a fallback when it
 * cannot know the answer, and null renders as an em dash. A mark of `0` for an
 * empty book would print a total loss; a PnL of `0` for an unknown mark would
 * print break-even. Both are lies about someone's money, and the second is the
 * one they would act on.
 */

/** Parses a money string, refusing anything that is not a finite number. */
function num(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * The mark, from the REST depth snapshot: the mid of the best bid and ask.
 *
 * It is deliberately the same number the order-book ladder is drawn from, so
 * the mark in the Positions row and the mid in the ladder cannot disagree on
 * screen. Since Phase 11 the depth it is given comes from the live socket for
 * the market the terminal is showing, and from a REST snapshot for the others —
 * see `markFor`.
 *
 * **A one-sided book has no mid.** Returning the only side present would mark
 * every position to a price at which nothing can trade — and a book with bids
 * and no asks is the normal state of this exchange early in a session, not an
 * edge case. Null, so the column says it does not know.
 *
 * Returns a STRING: this is a price, and prices are strings until something
 * needs to do arithmetic on them.
 */
export function midPrice(depth: Pick<TMarketDepth, "bids" | "asks">): string | null {
  const bestBid = num(depth.bids[0]?.[0]);
  const bestAsk = num(depth.asks[0]?.[0]);
  if (bestBid === null || bestAsk === null) return null;
  if (bestBid <= 0 || bestAsk <= 0) return null;
  return String((bestBid + bestAsk) / 2);
}

/**
 * Unrealised PnL — the same formula the engine uses in
 * `updateUnrealisedPnLForAllUsers`, deliberately, so the client's number and
 * the engine's agree whenever the engine's happens to be fresh.
 *
 *   LONG   (mark − entry) × qty
 *   SHORT  (entry − mark) × qty
 */
export function unrealisedPnl(
  position: Pick<Position, "type" | "qty" | "averagePrice">,
  mark: string | null,
): number | null {
  const markPrice = num(mark ?? undefined);
  const entry = num(position.averagePrice);
  const qty = num(position.qty);
  if (markPrice === null || entry === null || qty === null) return null;

  return position.type === "LONG"
    ? (markPrice - entry) * qty
    : (entry - markPrice) * qty;
}

/**
 * Return on equity: PnL as a percentage of the margin actually locked.
 *
 * Guarded against a zero margin rather than allowed to produce Infinity. Zero
 * margin is reachable: the engine sets `initialMargin` to 0 for a risk-reducing
 * order, and a netted-down position can end up carrying very little.
 */
export function roe(pnl: number | null, margin: string): number | null {
  const m = num(margin);
  if (pnl === null || m === null || m <= 0) return null;
  return (pnl / m) * 100;
}

/**
 * Leverage as the ENGINE derives it — `notional / margin`, using the position's
 * average entry price, not the mark.
 *
 * Same expression as the cap check in `placeOrder`, so the badge shows the
 * number the engine would compare against `maxLeverage` rather than a second
 * definition of the same word.
 */
export function positionLeverage(
  position: Pick<Position, "qty" | "margin" | "averagePrice">,
): number | null {
  const entry = num(position.averagePrice);
  const qty = num(position.qty);
  const margin = num(position.margin);
  if (entry === null || qty === null || margin === null || margin <= 0) {
    return null;
  }
  return (entry * qty) / margin;
}

export type DerivedPosition = {
  /** Mid of the book, or null when it has no two-sided price. */
  mark: string | null;
  unrealisedPnl: number | null;
  roe: number | null;
  leverage: number | null;
};

/** The four derived columns for one row, from the position and its mark. */
export function derivePosition(
  position: Position,
  mark: string | null,
): DerivedPosition {
  const pnl = unrealisedPnl(position, mark);
  return {
    mark,
    unrealisedPnl: pnl,
    roe: roe(pnl, position.margin),
    leverage: positionLeverage(position),
  };
}

/**
 * Account-wide unrealised PnL, for the header readout.
 *
 * **Null if ANY position's PnL is unknown.** A sum that silently skips the
 * positions it could not mark is a smaller number presented as a total, and the
 * header gives no indication which rows went into it. One em dash is the honest
 * summary of "some of this is unknown"; the per-row table below says which.
 *
 * An account with no positions has a total of exactly 0 — that one is knowable.
 */
export function totalUnrealisedPnl(
  rows: readonly { unrealisedPnl: number | null }[],
): number | null {
  let total = 0;
  for (const row of rows) {
    if (row.unrealisedPnl === null) return null;
    total += row.unrealisedPnl;
  }
  return total;
}

/**
 * Which mark a row gets: the live one where there is one, the snapshot
 * otherwise.
 *
 * The terminal holds a socket for exactly one market (ws-server settles the
 * market at the HTTP upgrade), while an account can hold positions in all
 * three. So one row's mark ticks with the book and the others are as fresh as
 * the last load — and the rule for choosing between them has two edges worth
 * writing down.
 *
 * **The live book wins even when it has no mid.** It is the same book, read
 * more recently; if it is one-sided now then this market has no mark now, and
 * falling back to the snapshot's mid would print a price at which nothing can
 * currently trade. An em dash is the honest answer, and it is the answer the
 * ladder beside it is already giving.
 *
 * **A feed that is reconnecting keeps its last depth**, so the mark freezes
 * with the ladder rather than vanishing. That is deliberate: the status dot is
 * what says the feed is stale, and blanking two columns as well would remove
 * information without adding any.
 */
export function markFor(
  marketId: string,
  restMarks: ReadonlyMap<string, string | null>,
  live: { marketId: string | null; mid: string | null },
): string | null {
  if (live.marketId !== null && live.marketId === marketId) return live.mid;
  return restMarks.get(marketId) ?? null;
}
