"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cancelOrder as cancelOrderRequest, getOpenOrders } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import type { OrderRecord } from "@/lib/api/schemas";
import type { Market } from "@/lib/markets";
import { useSession } from "@/lib/auth/session-provider";
import { useUserFeedSubscription } from "@/lib/user-feed";
import {
  isResting,
  reduceOpenOrders,
  type UserEvent,
  type UserOrder,
} from "@/lib/user-feed-core";

/**
 * The account's resting orders, across every market.
 *
 * Two things shape this file and neither is a preference.
 *
 * **The fan-out is a workaround, not a design.** Every order route on the
 * backend is market-scoped (G10), so "my open orders" is N requests and a merge
 * rather than one call. Doing it here keeps the shape of the eventual
 * `GET /orders/open` in view: one hook, one state, one `refresh()`, and the day
 * the endpoint exists only `load` changes.
 *
 * **It is a push target now, not a polling one.** As of Phase 13 the private
 * user channel owns the write path: `order.new` inserts a row, `order.update`
 * patches or removes one, and the reducer that does it is
 * `reduceOpenOrders` — pure, and tested against the events that arrive out of
 * order. What remains here is the SNAPSHOT: one fetch on mount, and one on
 * every (re)connect of the channel, which is the resync half of the
 * snapshot-then-drain discipline (§7.3).
 *
 * The focus listener and the refetch-after-cancel are both gone. They existed
 * to compensate for the missing channel, and keeping either would have hidden
 * a reducer bug behind a refetch that happened to paper over it.
 */

/**
 * An order row with its market resolved — the table needs a slug, not a UUID.
 *
 * Narrowed from the full `OrderRecord` in Phase 13, to exactly the columns the
 * table renders. The reason is that rows now arrive from two places: a REST
 * snapshot, and an `order.new` event off the private channel. The event
 * carries no `userId` (the topic it arrived on IS the user) and no
 * `updatedAt`, and synthesising either to satisfy a wider type would be
 * inventing data to fit a shape nothing reads.
 */
export type OpenOrder = Pick<
  OrderRecord,
  | "id"
  | "marketId"
  | "positionType"
  | "orderType"
  | "status"
  | "qty"
  | "filledQty"
  | "price"
  | "slippage"
  | "initialMargin"
  | "createdAt"
> & { market: Market };

export type OrdersState =
  | { status: "loading"; orders: null; error: null }
  | { status: "ready"; orders: OpenOrder[]; error: null }
  | { status: "error"; orders: null; error: string };

type OrdersValue = OrdersState & {
  /** Re-read every market's open orders. */
  refresh: () => Promise<void>;
  /**
   * Cancel one order, removing its row immediately and putting it back if the
   * request fails. Rejects with the reason so the caller can toast it.
   */
  cancel: (orderId: string) => Promise<void>;
  /** Ids with a cancel in flight — their row keeps a disabled button. */
  cancelling: readonly string[];
};

const OrdersContext = createContext<OrdersValue | null>(null);

export function useOrders(): OrdersValue {
  const value = useContext(OrdersContext);
  if (!value) {
    throw new Error("useOrders must be used inside <OrdersProvider>");
  }
  return value;
}

const IDLE: OrdersState = { status: "loading", orders: null, error: null };

/** Newest first. `createdAt` is an ISO string, which sorts correctly as text. */
function byNewest(a: OpenOrder, b: OpenOrder) {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export function OrdersProvider({
  markets,
  children,
}: {
  /**
   * Must be a STABLE reference — `MARKETS`, or something memoised.
   *
   * It is a dependency of `load`, which is a dependency of the mount effect, so
   * a fresh array literal on every render turns this into a fetch loop rather
   * than into a re-render.
   */
  markets: Market[];
  children: React.ReactNode;
}) {
  const session = useSession();
  const [state, setState] = useState<OrdersState>(IDLE);
  const [cancelling, setCancelling] = useState<string[]>([]);

  /**
   * Generation counter, not an AbortController.
   *
   * A cancel refreshes, and a refresh that started before it must not be the one
   * that lands — it would put the just-cancelled row back on screen. Aborting the
   * older request would also work for the network, but the race that matters is
   * between two `setState` calls, and only a generation check covers both.
   */
  const generation = useRef(0);
  /** Read inside `load` without making every market change re-create it. */
  const hasRows = useRef(false);

  /**
   * Cancels currently in flight, and whether the channel finished the order
   * out from under one. Phase 14's race audit (§7.3, "submit then immediately
   * cancel") found this.
   *
   * The cancel is optimistic, so the row is already off screen when the DELETE
   * is sent — which means an `order.update` saying the order FILLED arrives
   * while there is no row for the reducer to remove, and is correctly a no-op.
   * If the DELETE then fails (it will: the engine cannot cancel an order that
   * has already filled) the restore would put back a resting row for an order
   * that no longer exists, and nothing would take it away again until the next
   * reconnect. The map is what lets the failure path know the difference
   * between "the cancel was refused" and "the order finished first".
   */
  const cancelsInFlight = useRef(new Map<string, { finished: boolean }>());

  const load = useCallback(async () => {
    // A balances-style guard: requesting while anonymous 401s, and a 401 is what
    // the interceptor turns into a sign-out and a redirect.
    if (session.status !== "authed") return;

    const mine = ++generation.current;
    /**
     * Rows already on screen stay there while the request runs; a reload with
     * nothing to show goes back to the skeleton.
     *
     * Both halves matter. Flipping to `loading` on every refresh would blank the
     * table after each cancel and after each order placed — the two moments the
     * user is most attentive to it. Not flipping when there is nothing on screen
     * would leave "Try again" looking dead until the response lands.
     */
    if (!hasRows.current) setState(IDLE);

    try {
      /**
       * `Promise.all`, not `allSettled`.
       *
       * One market failing means the list is incomplete, and an incomplete list
       * of someone's resting orders is indistinguishable from an order having
       * been cancelled. Failing the whole panel is the honest outcome.
       */
      const perMarket = await Promise.all(
        markets.map(async (market) => {
          const rows = await getOpenOrders(market.id);
          return rows.map((row): OpenOrder => ({ ...row, market }));
        }),
      );

      if (mine !== generation.current) return;
      const merged = perMarket.flat().sort(byNewest);
      hasRows.current = true;
      setState({ status: "ready", orders: merged, error: null });
    } catch (err) {
      if (mine !== generation.current) return;
      if (err instanceof ApiError && err.isSilent) return;

      hasRows.current = false;
      setState({
        status: "error",
        orders: null,
        error:
          err instanceof ApiError ? err.message : "Could not load open orders.",
      });
    }
  }, [session.status, markets]);

  useEffect(() => {
    if (session.status === "loading") return;
    if (session.status === "anon") {
      generation.current++;
      hasRows.current = false;
      setState(IDLE);
      return;
    }
    void load();
  }, [session.status, load]);

  /**
   * Resolve a pushed order into a row.
   *
   * Returning null for a market this build does not know about is how the
   * event is ignored: the table renders a slug, and inventing one for an
   * unknown UUID would be worse than not showing the row. `markets` is a
   * stable reference (see the prop's note), so this closure is too.
   */
  const toRow = useCallback(
    (order: UserOrder): OpenOrder | null => {
      const market = markets.find((m) => m.id === order.marketId);
      if (!market) return null;
      return {
        id: order.id,
        marketId: order.marketId,
        positionType: order.positionType,
        orderType: order.orderType,
        status: order.status,
        qty: order.qty,
        filledQty: order.filledQty,
        price: order.price,
        slippage: order.slippage,
        initialMargin: order.initialMargin,
        createdAt: order.createdAt,
        market,
      };
    },
    [markets],
  );

  /**
   * The push path. This replaces the focus listener AND every
   * refetch-after-mutation that used to keep this list current.
   *
   * `resync` is `load` itself: on every (re)connect the channel refetches this
   * snapshot before delivering a single buffered event, so a reconnect can
   * never leave a row patched by an event whose baseline was lost.
   *
   * The batch is folded in order rather than applied event by event, because
   * one engine reply can both create an order and finish it — a market order
   * that filled instantly is an `order.new` followed by an `order.update`, and
   * the net effect on this list is nothing at all.
   */
  useUserFeedSubscription({
    resync: load,
    onEvents: (events: UserEvent[]) => {
      setState((prev) => {
        // Events arriving before the first snapshot are dropped: there is no
        // baseline to apply them to, and the snapshot they are racing already
        // contains everything they describe.
        if (prev.status !== "ready") return prev;

        let rows = prev.orders;
        for (const event of events) {
          // Watched before the reducer sees it: for an order whose row is
          // optimistically gone the reducer has nothing to do, and this is the
          // only place the transition is observable at all.
          if (
            event.type === "order.update" &&
            !isResting(event.status) &&
            cancelsInFlight.current.has(event.orderId)
          ) {
            cancelsInFlight.current.get(event.orderId)!.finished = true;
          }
          rows = reduceOpenOrders(rows, event, toRow);
        }
        if (rows === prev.orders) return prev;
        return { ...prev, orders: [...rows].sort(byNewest) };
      });
    },
  });

  const cancel = useCallback(
    async (orderId: string) => {
      /**
       * Optimistic, because cancelling a resting order does not realise money
       * and so does not confirm (CLAUDE.md). The row goes immediately; if the
       * request fails it comes back, in its original position — `byNewest` is a
       * pure function of the rows, so re-sorting after the restore puts it back
       * exactly where it was.
       */
      let removed: OpenOrder | undefined;
      const watch = { finished: false };
      cancelsInFlight.current.set(orderId, watch);
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        removed = prev.orders.find((o) => o.id === orderId);
        if (!removed) return prev;
        return { ...prev, orders: prev.orders.filter((o) => o.id !== orderId) };
      });
      setCancelling((prev) => [...prev, orderId]);

      try {
        await cancelOrderRequest(orderId);
        /**
         * No refetch. The engine publishes the cancellation and the released
         * margin on the private channel, and the optimistic removal above has
         * already taken the row off screen — so the event that follows finds
         * nothing to remove and changes nothing, which is exactly what an
         * idempotent reducer is for.
         */
      } catch (err) {
        setState((prev) => {
          if (prev.status !== "ready" || !removed) return prev;
          if (prev.orders.some((o) => o.id === orderId)) return prev;
          /**
           * The order finished while the cancel was in flight, so the refusal
           * is correct and the row must stay gone. Restoring it would put a
           * resting order on screen that the engine has already filled — the
           * one failure mode an optimistic removal can produce that the user
           * cannot see, because a restored row looks exactly like a row that
           * never left.
           */
          if (watch.finished) return prev;
          return { ...prev, orders: [...prev.orders, removed].sort(byNewest) };
        });
        throw err;
      } finally {
        cancelsInFlight.current.delete(orderId);
        setCancelling((prev) => prev.filter((id) => id !== orderId));
      }
    },
    [load],
  );

  const value = useMemo<OrdersValue>(
    () => ({ ...state, refresh: load, cancel, cancelling }),
    [state, load, cancel, cancelling],
  );

  return (
    <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>
  );
}
