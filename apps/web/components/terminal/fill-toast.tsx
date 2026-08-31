"use client";

import { useCallback } from "react";
import { formatNumber, truncateId } from "@/lib/format";
import type { Market } from "@/lib/markets";
import { Badge, Side, useToast, type ToastOptions } from "@/components/ui";

/**
 * Fill confirmations.
 *
 * This is the composition the toast system exists for, and it is the one place
 * where the two colour rules in CLAUDE.md pull against each other: a fill has a
 * STATUS (filled, partial, rejected) and a DIRECTION (long, short), and both
 * want to be the thing the toast is coloured by.
 *
 * They are resolved by giving them different jobs rather than a shared palette:
 *
 *   status    → the toast's own intent and the leading badge. Non-directional
 *               only. A completed fill uses `neutral`, NOT `success` — the
 *               success token aliases the long green, so a green-bordered
 *               "FILLED" on a SHORT fill would state the opposite of the truth.
 *   direction → the `Side` badge inside the body, which always prints the word
 *               LONG or SHORT. This is the only green or red in the toast.
 *
 * The result: exactly one directional colour per toast, attached to the one
 * fact that is actually directional.
 */

export type FillStatus =
  | "filled"
  | "partial"
  /** Accepted and resting on the book, nothing matched yet. */
  | "resting"
  | "rejected"
  /**
   * The request left and no answer came back — an engine timeout, or a dead
   * network. Phase 14.
   *
   * NOT a rejection, and the difference is the whole point of the state:
   * `POST /order` inserts the row and pushes it onto the stream before the
   * engine sees it, so a 503 `ENGINE_TIMEOUT` means the order may match a
   * second later. "Rejected" would be the client stating an outcome it was
   * never told. This says what is actually known — nothing — and points at the
   * place the answer will appear.
   */
  | "unknown"
  | "cancelled"
  /**
   * A forced close. The account did not place this order — the engine minted
   * it when the spot index crossed the position's liquidation price — which is
   * why it needs a word of its own rather than reading as an ordinary fill.
   *
   * It reaches the browser only over the private channel (Phase 13); there is
   * no request whose response could have carried it.
   */
  | "liquidated";

export type FillEvent = {
  /**
   * Optional because a rejected order has none: the engine refused it before
   * it became an order, and printing a plausible id would be a fabrication.
   */
  orderId?: string;
  side: "LONG" | "SHORT";
  status: FillStatus;
  /** Strings, from the engine, untouched — see the money rule in CLAUDE.md. */
  qty: string;
  /** Omitted when no price is true — a market order that matched nothing. */
  price?: string;
  market: Market;
  /** Engine reason, shown only on a rejection. */
  reason?: string;
};

/** Status word. Deliberately not colour-coded — the badge intent handles tone. */
const STATUS_LABEL: Record<FillStatus, string> = {
  filled: "Filled",
  partial: "Partially filled",
  resting: "Order placed",
  rejected: "Rejected",
  unknown: "Not confirmed",
  cancelled: "Cancelled",
  liquidated: "Liquidated",
};

const STATUS_BADGE: Record<FillStatus, "neutral" | "warning" | "danger" | "outline"> = {
  filled: "neutral",
  partial: "warning",
  // `danger`, which is non-directional — a liquidation can close a LONG or a
  // SHORT, and the `Side` badge beside it is the only thing in the toast
  // allowed to be green or red.
  liquidated: "danger",
  // Resting is the quietest outcome there is: the order exists and nothing has
  // happened to it. It borrows `cancelled`'s outline rather than earning a
  // colour, so only the two outcomes that moved money carry any weight.
  resting: "outline",
  rejected: "danger",
  // `warning`, not `danger`: nothing has failed. The order may well be resting
  // on the book. Non-directional either way — see the rule at the top.
  unknown: "warning",
  cancelled: "outline",
};

const STATUS_INTENT: Record<FillStatus, ToastOptions["intent"]> = {
  filled: "neutral",
  partial: "neutral",
  resting: "neutral",
  rejected: "danger",
  unknown: "warning",
  cancelled: "neutral",
  liquidated: "danger",
};

export function fillToastOptions(
  fill: FillEvent,
  onView?: () => void,
): ToastOptions {
  const { market, status } = fill;
  const isRejection = status === "rejected";
  /** No price and no order id are true for either of these. */
  const isUnresolved = isRejection || status === "unknown";
  // A liquidation is not a rejection — it has a price and a quantity, and both
  // are worth showing — but it earns the warning glyph and the longer dwell
  // for the same reason: it is the one outcome nobody asked for.
  const isAlarming = isUnresolved || status === "liquidated";

  return {
    intent: STATUS_INTENT[status],
    // A rejection keeps its glyph — that one is a genuine failure and the
    // triangle is non-chromatic reinforcement. A fill hides it, because the
    // only icon that fits is a green check and green is spoken for.
    hideIcon: !isAlarming,
    // Fills linger slightly longer than the 5s default: this is the receipt for
    // something that moved money, and it is often read after the fact.
    duration: isAlarming ? 8000 : 6000,
    title: (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge intent={STATUS_BADGE[status]} size="sm">
          {STATUS_LABEL[status]}
        </Badge>
        <Side side={fill.side} size="sm" />
        <span className="text-body-sm text-text-secondary">{market.slug}</span>
      </span>
    ),
    description: (
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="tnum text-text-primary">
          {formatNumber(fill.qty, market.sizeDecimals)} {market.base}
        </span>
        {!isUnresolved && fill.price !== undefined && (
          <>
            <span className="text-text-tertiary">@</span>
            <span className="tnum text-text-primary">
              {formatNumber(fill.price, market.priceDecimals)}
            </span>
          </>
        )}
        {fill.reason && (
          <span
            className={
              status === "unknown" ? "text-warning" : "text-danger-400"
            }
          >
            · {fill.reason}
          </span>
        )}
        {/* Mono is restricted to ids and hashes — this is one of the three
            places in the product that qualifies. */}
        {fill.orderId && (
          <span className="font-mono text-micro text-text-disabled">
            {truncateId(fill.orderId)}
          </span>
        )}
      </span>
    ),
    action: onView
      ? {
          label: isUnresolved ? "View order" : "View position",
          // Radix requires this: a screen-reader user cannot race the timeout,
          // so the alt text has to describe a durable route to the same place.
          altText: isUnresolved
            ? "Open the orders tab to review the order"
            : "Open the positions tab to view this position",
          onClick: onView,
        }
      : undefined,
  };
}

/** Fires a fill toast. Returns the toast id so a partial can be superseded. */
export function useFillToast() {
  const { toast } = useToast();
  return useCallback(
    (fill: FillEvent, onView?: () => void) =>
      toast(fillToastOptions(fill, onView)),
    [toast],
  );
}
