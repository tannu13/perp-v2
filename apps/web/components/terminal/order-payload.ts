import type { TCreateOrderSchema } from "@repo/shared";
import type { CreateOrderResult } from "@/lib/api/schemas";
import { ApiError } from "@/lib/api/errors";
import type { FillStatus } from "./fill-toast";

/**
 * The translation between the order ticket and the wire.
 *
 * Pure on purpose, and tested against `CreateOrderSchema` itself: this is the
 * highest-risk code in the ticket. The contract is a discriminated union whose
 * two arms disagree about which of `price` and `slippage` is allowed to be
 * non-zero, so a payload that is "nearly right" is not a 400 with a helpful
 * field name — it is a union that matches neither arm.
 *
 *   limit   price > 0, slippage === 0
 *   market  price === 0, slippage > 0 and an INTEGER
 *
 * Nothing here reads component state or fires a toast; the form does both, and
 * can therefore be reasoned about separately from the arithmetic.
 */

/** The ticket's state, as typed — strings, because inputs produce strings. */
export type TicketDraft = {
  marketSlug: string;
  side: "LONG" | "SHORT";
  orderType: "limit" | "market";
  /** Limit price. Ignored for a market order. */
  price: string;
  /** Whole-percent slippage band. Ignored for a limit order. */
  slippage: string;
  qty: string;
  /** Collateral to lock: notional / leverage, already computed by the ticket. */
  margin: number;
};

/**
 * `slippage` is an `integer` column in Postgres and the ticket used to default
 * it to "0.5", which Postgres would have rounded to 1 (or 0) behind the user's
 * back. The input now refuses a decimal point, so this is the second line of
 * defence rather than the first — but a value that reached the wire fractional
 * would be silently changed *after* the confirm dialog said what it was.
 *
 * The floor of 1 is the schema's: `z.coerce.number().positive()` rejects 0.
 */
export function toWholePercent(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.round(parsed));
}

/**
 * Margin, rounded UP to 8 decimal places.
 *
 * `notional / leverage` is a float division and lands on things like
 * 33.333333333333336, which would be stored verbatim in a varchar column. It
 * rounds up rather than to nearest because the engine derives leverage as
 * `price * qty / initialMargin` and compares it against the market cap: a
 * margin rounded *down* raises the derived leverage and can push an order at
 * exactly the cap over it. Up costs the user a hundred-millionth of a dollar
 * and cannot fail that check.
 */
export function roundMarginUp(margin: number): number {
  if (!Number.isFinite(margin) || margin <= 0) return 0;
  const scale = 1e8;
  return Math.ceil(margin * scale) / scale;
}

/**
 * Builds the `POST /order` body.
 *
 * `equity` is always sent. The engine only makes it optional for a genuinely
 * risk-reducing order — an opposite-side order no larger than the position it
 * offsets — and decides that for itself; a ticket that omitted it on a guess
 * would be rejected with "Margin required as there is no open position".
 */
export function buildOrderPayload(draft: TicketDraft): TCreateOrderSchema {
  const common = {
    market: draft.marketSlug,
    type: draft.side,
    qty: Number.parseFloat(draft.qty),
    equity: roundMarginUp(draft.margin),
  } as const;

  if (draft.orderType === "limit") {
    return {
      orderType: "limit",
      price: Number.parseFloat(draft.price),
      slippage: 0,
      ...common,
    };
  }

  return {
    orderType: "market",
    price: 0,
    slippage: toWholePercent(draft.slippage),
    ...common,
  };
}

/** What the toast should say, derived only from what the engine reported. */
export type OrderOutcome = {
  status: FillStatus;
  /** Quantity to show: what filled, or what was asked for if nothing did. */
  qty: string;
  /** Omitted when no price is true — a resting market order has none. */
  price?: string;
};

/**
 * Reads the engine's reply.
 *
 * The price shown for anything that filled is `averagePrice`, never the price
 * the ticket submitted. That is **G29**: for a market order the engine
 * overwrites `price` with the slippage percent before persisting, so
 * `orders.price` on a market order is `1`, not a price. Sourcing the display
 * from the executed average makes that column irrelevant to the UI.
 */
export function outcomeFromResult(
  result: CreateOrderResult,
  draft: Pick<TicketDraft, "qty" | "price" | "orderType">,
): OrderOutcome {
  const filled = Number.parseFloat(result.filledQty);
  const requested = Number.parseFloat(draft.qty);

  if (Number.isFinite(filled) && filled > 0) {
    return {
      // `>=` rather than `===`: the comparison is between two floats parsed
      // from strings, and an over-fill is not a thing the engine can do.
      status: filled >= requested ? "filled" : "partial",
      qty: result.filledQty,
      price: result.averagePrice,
    };
  }

  // Nothing filled. A limit order is now resting on the book at its own price;
  // a market order that matched nothing was cancelled and never had a price.
  if (result.status === "cancelled") {
    return { status: "cancelled", qty: draft.qty };
  }

  return {
    status: "resting",
    qty: draft.qty,
    price: draft.orderType === "limit" ? draft.price : undefined,
  };
}

/**
 * The words to show a user whose order was refused.
 *
 * The engine's own message is the useful one — "User does not have available
 * margin", "Leverage not supported", "There are no matches available" — and it
 * arrives as the `ApiError` message. Nothing is invented here: an error with no
 * message gets a generic line rather than a guess at the cause.
 */
export function rejectionMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const field = err.fieldErrors && Object.values(err.fieldErrors)[0];
    if (field) return field;
    if (err.message) return err.message;
  }
  return "The order could not be placed.";
}

/**
 * Joins a message the server wrote to a sentence of ours.
 *
 * Engine and backend messages are shown verbatim (§7.4) — but their
 * punctuation is not ours to assume, and the backend's `ENGINE_TIMEOUT`
 * message ends without a full stop. Appending to it directly produced
 * "The matching engine is not responding Check Open orders before placing it
 * again." on the ticket, the close dialog and the cancel toast: three
 * surfaces, all read under pressure, all of them ours to punctuate. Found in
 * the browser in Phase 15, which is the only place it could have been found —
 * every unit test asserting these lines matches a fragment.
 */
export function followedBy(message: string, followUp: string): string {
  const said = message.trim();
  if (!said) return followUp;
  return `${/[.!?]$/.test(said) ? said : `${said}.`} ${followUp}`;
}

/**
 * The slippage band a close is submitted with, in whole percent.
 *
 * A close is a market order and therefore a limit order at the worst price the
 * trader accepts (see the engine's `placeOrder`), so this number decides
 * whether the position actually flattens. Too tight and the close fills
 * partially or not at all, leaving the user holding risk they just asked to be
 * rid of; too wide and they cross the book at a price they never saw.
 *
 * 1% matches the ticket's own default, which is the number the user has already
 * been shown for every market order they have placed. It is a constant rather
 * than a control because the dialog is a confirm, not a second ticket — the
 * plan puts partial and priced closes out of scope.
 */
export const CLOSE_SLIPPAGE_PERCENT = 1;

/**
 * The body that flattens a position.
 *
 * Three things make this different from `buildOrderPayload`, and the engine
 * refuses the order if any one of them is wrong.
 *
 * **`equity` is omitted.** That is what marks the order risk-reducing (G13):
 * with no margin supplied and an opposite-side position at least as large,
 * `placeOrder` sets `initialMargin` to 0, skips the collateral debit and skips
 * the leverage cap. Sending the position's margin instead would lock a second
 * margin to close a position — the user needs free collateral to get flat,
 * which is exactly backwards.
 *
 * **`type` is the opposite side.** One-way netting means an opposite-side order
 * for the full size nets the position to zero and closes it; a same-side order
 * doubles it.
 *
 * **It is a market order.** `price: 0` and a positive integer `slippage`, which
 * is the market arm of `CreateOrderSchema` — the discriminated union has no
 * helpful error for a payload that is nearly right.
 *
 * `qty` is the FULL position size. Partial closes are out of scope: the dialog
 * has no size control, and a builder that could express one would be untested
 * surface area.
 */
export function buildClosePayload(position: {
  market: { slug: string };
  type: "LONG" | "SHORT";
  qty: string;
}): TCreateOrderSchema {
  return {
    orderType: "market",
    price: 0,
    slippage: CLOSE_SLIPPAGE_PERCENT,
    market: position.market.slug,
    type: position.type === "LONG" ? "SHORT" : "LONG",
    qty: Number.parseFloat(position.qty),
    // Deliberately absent, not `undefined` by accident — see above.
  };
}
