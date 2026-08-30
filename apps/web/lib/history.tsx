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
import { getFills, getOrders } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import type { FillView, OrderRecord } from "@/lib/api/schemas";
import type { Market } from "@/lib/markets";
import { useSession } from "@/lib/auth/session-provider";
import {
  fillsByOrder,
  historyPrice,
  isHistoricalOrder,
} from "@/lib/order-history";

/**
 * The two historical tabs: every fill the account has taken part in, and every
 * order it has finished with.
 *
 * The fourth provider of this shape — see D2 in PROGRESS.md. It shares the
 * generation counter, the "fail the panel rather than show a partial list"
 * rule and the deliberate refusal to poll with `OrdersProvider` and
 * `PositionsProvider`. Three things are its own.
 *
 * **It is lazy.** Positions, open orders and balances are needed to trade;
 * history is needed to look back. Nothing here is fetched until one of its two
 * tabs is opened, so the terminal's first paint costs four requests fewer.
 *
 * **Both tabs load together, and share one status.** They are not independent:
 * a market order's `orders.price` column is 0 (G29), so the only place its
 * executed price exists is in its fills. Order history without the fills would
 * have to print an em dash for every market order it has — which is not "we are
 * still loading", it is wrong. One load, one failure, one retry.
 *
 * **Fills are paged.** `GET /fills` is account-wide and, before Phase 10, was
 * unbounded (G11). It now returns a cursor; `loadMore` walks it. Order history
 * is still a fan-out over markets because every order route is market-scoped
 * (G10), and it has no cursor.
 */

/** How many fills the first page asks for. `loadMore` fetches the same again. */
const FILLS_PAGE_SIZE = 100;

/** A fill with its market resolved, when the market is one we know about. */
export type FillRow = FillView & { market: Market | null };

/**
 * A finished order with its market and the price the table should print —
 * `null` for a market order whose fills we have none of. See `historyPrice`.
 */
export type HistoryOrder = OrderRecord & {
  market: Market;
  displayPrice: string | null;
};

export type HistoryState =
  | { status: "idle"; fills: null; orders: null; error: null }
  | { status: "loading"; fills: null; orders: null; error: null }
  | {
      status: "ready";
      fills: FillRow[];
      orders: HistoryOrder[];
      error: null;
    }
  | { status: "error"; fills: null; orders: null; error: string };

type HistoryValue = HistoryState & {
  /**
   * Called when either historical tab becomes visible. Loads on the first call
   * and refreshes in the background on every later one — switching back to a
   * tab after placing an order is the moment its fill is expected to be there,
   * and there is no push channel until Phase 13.
   */
  activate: () => void;
  refresh: () => Promise<void>;
  /** Appends the next page of fills. Undefined when there are no more. */
  loadMore: (() => Promise<void>) | undefined;
  loadingMore: boolean;
};

const HistoryContext = createContext<HistoryValue | null>(null);

export function useHistory(): HistoryValue {
  const value = useContext(HistoryContext);
  if (!value) {
    throw new Error("useHistory must be used inside <HistoryProvider>");
  }
  return value;
}

const IDLE: HistoryState = {
  status: "idle",
  fills: null,
  orders: null,
  error: null,
};

/** Newest first. `createdAt` is an ISO string, which sorts correctly as text. */
function byNewest(a: { createdAt: string }, b: { createdAt: string }) {
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
}

export function HistoryProvider({
  markets,
  children,
}: {
  /** Must be a STABLE reference — it is a dependency of `load`. */
  markets: Market[];
  children: React.ReactNode;
}) {
  const session = useSession();
  const [state, setState] = useState<HistoryState>(IDLE);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  /** A refresh that started before a newer one must not be the one that lands. */
  const generation = useRef(0);
  /**
   * Whether a tab has ever asked for this data.
   *
   * State AND a ref. The state drives the load effect below; the ref is what
   * `activate` and the focus listener read without taking a dependency on it.
   */
  const [activated, setActivated] = useState(false);
  const activatedRef = useRef(false);
  const hasRows = useRef(false);

  const load = useCallback(async () => {
    if (session.status !== "authed") return;

    const mine = ++generation.current;
    // Rows on screen survive a refresh; an empty panel goes to the skeleton.
    if (!hasRows.current) {
      setState({ status: "loading", fills: null, orders: null, error: null });
    }

    try {
      /**
       * `Promise.all`, not `allSettled`, for the same reason as the other
       * providers: a partial history is indistinguishable from a shorter one,
       * and a missing fill is a trade the user cannot see they made.
       */
      const [fillsPage, ordersPerMarket] = await Promise.all([
        getFills({ limit: FILLS_PAGE_SIZE }),
        Promise.all(
          markets.map(async (market) => {
            const rows = await getOrders(market.id);
            return rows.map((row) => ({ row, market }));
          }),
        ),
      ]);

      if (mine !== generation.current) return;

      const fills = fillsPage.fills
        .map(
          (fill): FillRow => ({
            ...fill,
            market: markets.find((m) => m.id === fill.marketId) ?? null,
          }),
        )
        .sort(byNewest);

      const byOrder = fillsByOrder(fillsPage.fills);
      const orders = ordersPerMarket
        .flat()
        .filter(({ row }) => isHistoricalOrder(row))
        .map(
          ({ row, market }): HistoryOrder => ({
            ...row,
            market,
            displayPrice: historyPrice(row, byOrder.get(row.id) ?? []),
          }),
        )
        .sort(byNewest);

      hasRows.current = true;
      setCursor(fillsPage.nextCursor);
      setState({ status: "ready", fills, orders, error: null });
    } catch (err) {
      if (mine !== generation.current) return;
      if (err instanceof ApiError && err.isAuthFailure) return;

      hasRows.current = false;
      setCursor(null);
      setState({
        status: "error",
        fills: null,
        orders: null,
        error:
          err instanceof ApiError ? err.message : "Could not load your history.",
      });
    }
  }, [session.status, markets]);

  const activate = useCallback(() => {
    // Already on: this is a return visit to the tab, so refresh behind the rows
    // that are already there.
    if (activatedRef.current) {
      void load();
      return;
    }
    activatedRef.current = true;
    setActivated(true);
  }, [load]);

  /**
   * The first load, and the reason it is an effect rather than a call inside
   * `activate`.
   *
   * A tab can be opened before `/me` has answered — it is one click on a page
   * that is still booting — and `load` refuses to run while the session is
   * unresolved, because requesting anonymously 401s and a 401 is what the
   * interceptor turns into a sign-out. Calling it directly from `activate`
   * therefore left the panel on its skeleton forever, with nothing to retry it.
   * Keyed on the session status instead, the load simply happens when the
   * session arrives.
   */
  useEffect(() => {
    if (!activated) return;
    if (session.status !== "authed") return;
    void load();
  }, [activated, session.status, load]);

  /**
   * Sign-out clears it and drops the activation: the next account to sign in on
   * this tab must not inherit a panel of somebody else's trades, and must not
   * silently re-fetch history it never asked to see.
   */
  useEffect(() => {
    if (session.status === "anon") {
      generation.current++;
      activatedRef.current = false;
      hasRows.current = false;
      setActivated(false);
      setCursor(null);
      setState(IDLE);
    }
  }, [session.status]);

  /** Same focus refresh as the other providers, but only once a tab wants it. */
  useEffect(() => {
    if (session.status !== "authed") return;
    const onFocus = () => {
      if (!activatedRef.current) return;
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [session.status, load]);

  /**
   * The next page of fills, appended.
   *
   * It does NOT re-derive order history: a page of older fills can only belong
   * to orders older than the ones already priced, and re-running the join would
   * be work for no change. If that stops being true — an order whose fills span
   * a page boundary — the fix is to widen the bucket, not to reprice the table.
   */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    const mine = generation.current;

    try {
      const page = await getFills({ limit: FILLS_PAGE_SIZE, before: cursor });
      if (mine !== generation.current) return;

      setCursor(page.nextCursor);
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        const seen = new Set(prev.fills.map((f) => `${f.id}:${f.role}`));
        const older = page.fills
          .filter((f) => !seen.has(`${f.id}:${f.role}`))
          .map(
            (fill): FillRow => ({
              ...fill,
              market: markets.find((m) => m.id === fill.marketId) ?? null,
            }),
          );
        return { ...prev, fills: [...prev.fills, ...older].sort(byNewest) };
      });
    } catch (err) {
      // A failed page leaves what is on screen alone — it is still true, just
      // shorter. The cursor is kept so the button can be pressed again.
      if (err instanceof ApiError && err.isAuthFailure) return;
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, markets]);

  const value = useMemo<HistoryValue>(
    () => ({
      ...state,
      activate,
      refresh: load,
      loadMore: cursor ? loadMore : undefined,
      loadingMore,
    }),
    [state, activate, load, cursor, loadMore, loadingMore],
  );

  return (
    <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>
  );
}
