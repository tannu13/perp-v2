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
import {
  createOrder,
  getDepth,
  getOpenPositions,
} from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import type { Position } from "@/lib/api/schemas";
import type { Market } from "@/lib/markets";
import { useSession } from "@/lib/auth/session-provider";
import { useMarketFeedOptional } from "@/lib/market-feed";
import { useUserFeedSubscription } from "@/lib/user-feed";
import {
  reducePositionEntries,
  type UserEvent,
  type UserPosition,
} from "@/lib/user-feed-core";
import {
  derivePosition,
  markFor,
  midPrice,
  totalUnrealisedPnl,
  type DerivedPosition,
} from "@/lib/position-math";
import { buildClosePayload } from "@/components/terminal/order-payload";

/**
 * The account's open positions, across every market, with their derived columns.
 *
 * Modelled on `OrdersProvider` deliberately and almost line for line: the same
 * fan-out over `MARKETS` because every position route is market-scoped (G10),
 * the same `Promise.all`-not-`allSettled` rule, the same generation counter, the
 * same refresh triggers, the same no-polling stance. That this is now the third
 * provider with that shape is the argument for D2 in PROGRESS.md, not a reason
 * to build the abstraction inside this phase.
 *
 * Two things are its own.
 *
 * **Its marks come from two places, and the split is the honest one.** The
 * market the terminal is showing has a live socket, so its mark is the mid of
 * the book the feed is holding and moves at the poller's ~1 Hz. Every other
 * market the account has a position in has no socket — the connection carries
 * one market's topics and opening three would be three sockets for two columns
 * — so its mark is the mid of a REST snapshot taken at load. Both are the same
 * quantity computed by the same function; only the freshness differs, and the
 * one on screen is the fresh one.
 *
 * **Closing is not optimistic.** Cancel removes a row before the server agrees
 * because a cancel realises nothing. A close submits a market order that
 * realises PnL at a price the book decides, and can be refused outright
 * ("There are no matches available") — so the row stays until the refetch says
 * otherwise, and the button confirms first.
 */

/** A position with its market resolved and its derived columns attached. */
export type OpenPosition = Position & { market: Market } & DerivedPosition;

/**
 * What one load produced: the rows, and the REST mark each market had at the
 * time. Derivation is deliberately NOT baked in here — it happens on render,
 * because the mark of the displayed market changes with every depth frame and a
 * PnL column that only moved when something was refetched would be a snapshot
 * pretending to be live.
 */
type Loaded = {
  entries: { position: Position; market: Market }[];
  /** marketId → REST depth mid at load, or null where the book had no mid. */
  marks: Map<string, string | null>;
};

type InternalState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: Loaded; error: null }
  | { status: "error"; data: null; error: string };

export type PositionsState =
  | { status: "loading"; positions: null; error: null }
  | { status: "ready"; positions: OpenPosition[]; error: null }
  | { status: "error"; positions: null; error: string };

type PositionsValue = PositionsState & {
  /** Re-read every market's positions and their marks. */
  refresh: () => Promise<void>;
  /**
   * Flatten one position with a full-size market order. Rejects with the
   * engine's own reason so the caller can toast it verbatim.
   */
  close: (position: OpenPosition) => Promise<void>;
  /** Market ids with a close in flight — their row keeps a disabled button. */
  closing: readonly string[];
  /**
   * Account-wide unrealised PnL, or null if any position could not be marked.
   * The header reads this; see `totalUnrealisedPnl`.
   */
  totalUnrealisedPnl: number | null;
};

const PositionsContext = createContext<PositionsValue | null>(null);

export function usePositions(): PositionsValue {
  const value = useContext(PositionsContext);
  if (!value) {
    throw new Error("usePositions must be used inside <PositionsProvider>");
  }
  return value;
}

/**
 * The same context, read from outside the terminal.
 *
 * `SiteHeader` renders on the landing page and the design-system pages as well
 * as inside the terminal, and only the terminal mounts this provider — fanning
 * three position requests out of a marketing page would be absurd. So the
 * header asks, and gets null where there is no provider, which it renders as an
 * em dash: "not known here", which is exactly true.
 */
export function usePositionsOptional(): PositionsValue | null {
  return useContext(PositionsContext);
}

const IDLE: InternalState = { status: "loading", data: null, error: null };

/** Stable order, so a refresh never reshuffles the table under the pointer. */
function bySlug(a: OpenPosition, b: OpenPosition) {
  return a.market.slug.localeCompare(b.market.slug);
}

/**
 * Marks for the markets the account actually holds, as the mid of each book.
 *
 * **`allSettled`, unlike the positions read above it, and the difference is not
 * an inconsistency.** A missing position is indistinguishable from a closed one
 * and must fail the panel. A missing mark is a column that says "—" on a row
 * whose size, entry, margin and liquidation price are all still true and still
 * worth showing. Failing the whole table because a depth snapshot timed out
 * would hide more than it protects.
 *
 * Phase 11 narrowed this rather than deleting it: the displayed market's mark
 * now comes from the live feed and overrides whatever this returned for it.
 */
async function loadMarks(markets: Market[]): Promise<Map<string, string | null>> {
  const results = await Promise.allSettled(
    markets.map(async (market) => {
      const depth = await getDepth(market.id);
      return [market.id, midPrice(depth)] as const;
    }),
  );

  const marks = new Map<string, string | null>();
  for (const [i, result] of results.entries()) {
    const marketId = markets[i]!.id;
    marks.set(marketId, result.status === "fulfilled" ? result.value[1] : null);
  }
  return marks;
}

export function PositionsProvider({
  markets,
  children,
}: {
  /** Must be a STABLE reference — see the same note on `OrdersProvider`. */
  markets: Market[];
  children: React.ReactNode;
}) {
  const session = useSession();
  const [state, setState] = useState<InternalState>(IDLE);
  /**
   * The live book for the market on screen, if a feed is mounted at all. Null
   * on any surface that renders positions without a terminal around them — the
   * REST marks below stand alone there.
   */
  const feed = useMarketFeedOptional();
  const [closing, setClosing] = useState<string[]>([]);

  /** See `OrdersProvider`: the race that matters is between two setStates. */
  const generation = useRef(0);
  const hasRows = useRef(false);

  const load = useCallback(async () => {
    if (session.status !== "authed") return;

    const mine = ++generation.current;
    // Rows on screen survive a refresh; a reload from empty shows the skeleton.
    if (!hasRows.current) setState(IDLE);

    try {
      /**
       * `Promise.all`, not `allSettled` — the same reasoning as the orders
       * fan-out, and it bites harder here. A position that fails to load and is
       * quietly omitted looks exactly like a position that was closed or
       * liquidated, and the row that vanished is the one carrying the money.
       */
      const perMarket = await Promise.all(
        markets.map(async (market) => {
          const rows = await getOpenPositions(market.id);
          return { market, rows };
        }),
      );

      if (mine !== generation.current) return;

      const held = perMarket.filter((entry) => entry.rows.length > 0);
      const marks = await loadMarks(held.map((entry) => entry.market));

      if (mine !== generation.current) return;

      const entries = held.flatMap(({ market, rows }) =>
        rows.map((position) => ({ position, market })),
      );

      hasRows.current = true;
      setState({ status: "ready", data: { entries, marks }, error: null });
    } catch (err) {
      if (mine !== generation.current) return;
      if (err instanceof ApiError && err.isSilent) return;

      hasRows.current = false;
      setState({
        status: "error",
        data: null,
        error:
          err instanceof ApiError ? err.message : "Could not load positions.",
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
   * The push path.
   *
   * `resync` is `load`, so every (re)connect of the channel re-reads positions
   * AND their marks before a buffered event is delivered — which is also what
   * replaces the focus listener this provider used to carry. A tab left hidden
   * long enough loses its socket, and coming back runs the full snapshot path.
   *
   * A position in a market this load never fetched a mark for renders an em
   * dash in the Mark and PnL columns until the next resync. That is the
   * existing rule for an unmarkable row (`position-math.ts`), reached by a new
   * path — a first position opened in a market the account was flat in — and
   * `markForNewMarkets` below closes it without a refetch of anything else.
   */
  const toEntry = useCallback(
    (position: UserPosition): { position: Position; market: Market } | null => {
      const market = markets.find((m) => m.id === position.marketId);
      if (!market) return null;
      return {
        market,
        position: {
          marketId: position.marketId,
          type: position.type,
          qty: position.qty,
          margin: position.margin,
          averagePrice: position.averagePrice,
          liquidationPrice: position.liquidationPrice,
        },
      };
    },
    [markets],
  );

  /** Market ids a pushed position introduced that we hold no mark for yet. */
  const [unmarked, setUnmarked] = useState<string[]>([]);

  useUserFeedSubscription({
    resync: load,
    onEvents: (events: UserEvent[]) => {
      setState((prev) => {
        // Nothing to apply an event to before the first snapshot; the snapshot
        // it is racing already contains everything it describes.
        if (prev.status !== "ready") return prev;

        let entries = prev.data.entries;
        for (const event of events) {
          entries = reducePositionEntries(entries, event, {
            marketIdOf: (entry) => entry.market.id,
            toEntry,
          });
        }
        if (entries === prev.data.entries) return prev;

        const missing = entries
          .map((e) => e.market.id)
          .filter((id) => !prev.data.marks.has(id));
        if (missing.length) {
          // Identity-stable when nothing is new. This is a dependency of the
          // effect below, which fetches — returning a fresh array on every
          // event would turn a position update into a `GET /depth` loop.
          setUnmarked((ids) =>
            missing.every((id) => ids.includes(id))
              ? ids
              : [...new Set([...ids, ...missing])],
          );
        }

        return { ...prev, data: { ...prev.data, entries } };
      });
    },
  });

  /**
   * A mark for a market the account has only just taken a position in.
   *
   * The alternative was to refetch everything on the first fill in a new
   * market, which is the refetch-on-mutation this phase removes. This asks for
   * the one thing that is actually missing — one `GET /depth` — and merges it
   * into the marks map.
   */
  useEffect(() => {
    if (unmarked.length === 0) return;
    let cancelled = false;
    const wanted = markets.filter((m) => unmarked.includes(m.id));

    void loadMarks(wanted).then((fresh) => {
      if (cancelled) return;
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        const marks = new Map(prev.data.marks);
        for (const [id, mid] of fresh) marks.set(id, mid);
        return { ...prev, data: { ...prev.data, marks } };
      });
      // Same rule from the other side: a mark request that answered for none
      // of the ids it was asked about must not re-arm the effect.
      setUnmarked((ids) => {
        const next = ids.filter((id) => !fresh.has(id));
        return next.length === ids.length ? ids : next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [unmarked, markets]);

  const close = useCallback(
    async (position: OpenPosition) => {
      setClosing((prev) => [...prev, position.marketId]);
      try {
        await createOrder(buildClosePayload(position));
        /**
         * No refetch. A close is still NOT optimistic — the row stays until
         * something says otherwise, and the dialog stays open on failure — but
         * what says otherwise is now the `position: null` event the engine
         * publishes, not a list this component asked for again.
         */
      } finally {
        setClosing((prev) => prev.filter((id) => id !== position.marketId));
      }
    },
    [load],
  );

  /**
   * The live mid of the market the terminal is showing, if any. The rule for
   * choosing between it and the REST marks is `markFor`, which is where the two
   * edges of that choice are written down and tested.
   */
  const liveMarketId = feed?.depth?.market ?? null;
  const liveMid = useMemo(
    () => (feed?.depth ? midPrice(feed.depth) : null),
    [feed?.depth],
  );

  const positions = useMemo(() => {
    if (state.status !== "ready") return null;
    const { entries, marks } = state.data;
    const live = { marketId: liveMarketId, mid: liveMid };
    return entries
      .map(({ position, market }): OpenPosition => ({
        ...position,
        market,
        ...derivePosition(position, markFor(market.id, marks, live)),
      }))
      .sort(bySlug);
  }, [state, liveMarketId, liveMid]);

  const value = useMemo<PositionsValue>(
    () => ({
      status: state.status,
      positions,
      error: state.error,
      refresh: load,
      close,
      closing,
      // Computed here rather than in the header so there is one definition of
      // "the account's unrealised PnL" and it is the tested one.
      totalUnrealisedPnl: positions === null ? null : totalUnrealisedPnl(positions),
    }) as PositionsValue,
    [state.status, state.error, positions, load, close, closing],
  );

  return (
    <PositionsContext.Provider value={value}>
      {children}
    </PositionsContext.Provider>
  );
}
