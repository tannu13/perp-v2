"use client";

import { MARKETS } from "@/lib/markets";
import { useFillToast, type FillStatus } from "@/components/terminal/fill-toast";
import { useUserFeedSubscription } from "@/lib/user-feed";
import {
  groupFills,
  rememberFills,
  type UserEvent,
} from "@/lib/user-feed-core";
import { useRef } from "react";

/**
 * Fill confirmations that nobody asked for.
 *
 * This is the surface Phase 13 exists to make possible. A **maker** — someone
 * whose resting order is hit by a stranger — sends no request at the moment
 * they trade and has no response to read, so before the private channel their
 * only way to find out was to look. The same is true, more sharply, of a
 * **liquidation**: an order the account never placed, filling a position it
 * still thought it had.
 *
 * It renders nothing. It sits in the root layout inside `ToastProvider`
 * because a fill can land while the user is anywhere in the app — the landing
 * page, a dialog, another market's chart — and a notification that only worked
 * on the terminal would miss exactly the case it is for.
 *
 * **What it deliberately does NOT toast: the submitter's own fills.** An order
 * the account placed comes back through `POST /order` synchronously with the
 * engine's own outcome, and the ticket has always reported it from there. That
 * is a better source than this one — it is the same fact, one hop earlier, and
 * it is still true when ws-server is down. Toasting it here as well would
 * double every confirmation in the app.
 *
 * The rule that separates them is exact rather than heuristic: an order only
 * ever TAKES liquidity in the same engine reply that created it, so a `taker`
 * fill on a `user`-origin order is always one the ticket is already reporting.
 * Everything else — every `maker` fill, and every fill on a liquidation order
 * — has no request behind it and belongs here.
 */
export function FillNotifications() {
  const fillToast = useFillToast();

  /**
   * Fill ids already announced.
   *
   * A row is idempotent — applying the same event twice leaves the same row —
   * but a toast is not: the user reads it once and it is gone. The reconnect
   * drain deliberately replays events that the REST snapshot may already
   * cover, so without this a reconnect during a busy moment would re-announce
   * trades from before it. Bounded, in `rememberFills`.
   *
   * A ref rather than state: nothing renders from it, and making it state
   * would re-render the whole subtree on every fill in the exchange.
   */
  const seen = useRef<ReadonlySet<string>>(new Set());

  useUserFeedSubscription({
    onEvents: (events: UserEvent[]) => {
      const groups = groupFills(events, seen.current);
      if (groups.length === 0) return;

      /** Orders created in THIS batch, by id — the origin lives here. */
      const created = new Map(
        events
          .filter((e) => e.type === "order.new")
          .map((e) => [e.order.id, e] as const),
      );
      /** The final state of each order in this batch, if it was reported. */
      const finished = new Map(
        events
          .filter((e) => e.type === "order.update")
          .map((e) => [e.orderId, e] as const),
      );

      for (const group of groups) {
        const origin = created.get(group.orderId)?.origin;

        // The ticket's own receipt. See the note above — this is the only case
        // where a fill reaches the user by a shorter path than this one.
        if (group.role === "taker" && origin !== "liquidation") {
          seen.current = rememberFills(seen.current, group.fillIds);
          continue;
        }

        const market = MARKETS.find((m) => m.id === group.marketId);
        // Unknown market: nothing honest to print. The Fills tab still has it.
        if (!market) continue;

        const status: FillStatus =
          origin === "liquidation"
            ? "liquidated"
            : finished.get(group.orderId)?.status === "filled"
              ? "filled"
              : "partial";

        fillToast({
          orderId: group.orderId,
          side: group.side,
          status,
          qty: group.qty,
          price: group.price,
          market,
        });

        seen.current = rememberFills(seen.current, group.fillIds);
      }
    },
  });

  return null;
}
