"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getDepth } from "@/lib/api/endpoints";
import type { Market } from "@/lib/markets";
import {
  backoffDelay,
  initialMachine,
  onColdSnapshot,
  onDisconnect,
  onFrame,
  onOpen,
  onRetrying,
  onSnapshot,
  parseFrame,
  STALE_AFTER_MS,
  type FeedState,
  type Machine,
} from "@/lib/market-feed-core";

export {
  STALE_AFTER_MS,
  TRADES_PUBLISHED,
  type Depth,
  type DepthLevel,
  type FeedSource,
  type FeedState,
  type Trade,
} from "@/lib/market-feed-core";

/**
 * The one place in the app that opens a market-data socket.
 *
 * It replaces `useMarketFeed(market)`, which opened a socket per hook call and
 * fell back to a **simulator** — a random walk, an invented book and a fake
 * trade tape — whenever the stack was not up. That simulator is deleted. There
 * is no longer any state in which fabricated market data reaches the UI (G21):
 * when the feed is down the ladder holds the last thing the server said and the
 * status dot says `reconnecting` or `disconnected`.
 *
 * Everything the socket needs is settled at the HTTP upgrade — ws-server's
 * `message(ws) {}` is empty, so there is no subscribe frame and no way to
 * change market on a live connection (§4.1). Switching market therefore tears
 * the socket down and opens a new one, which is why this is a provider keyed on
 * the market rather than a hook: one owner, one socket, one teardown.
 *
 * The pure half — parsing, the snapshot/buffer reconciliation and the backoff
 * schedule — is in `market-feed-core.ts` and is unit-tested there.
 */

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3010";

/**
 * All four feeds carry something real as of Phase 12.
 *
 * `mark-price` and `trades` were subscribed through Phase 11 while publishing
 * nothing (G15, G16) — subscribing was free and it meant the client needed no
 * change on the day the engine started sending them. It did not, quite: the
 * `mark-price` frame was dropped in `parseFrame` on purpose, because what the
 * feed carried was the seed value. Both are live now.
 */
const FEEDS = "last-traded-price,mark-price,depth,trades";

/**
 * How long a hidden tab keeps its socket. Long enough that flipping to another
 * tab and back does not churn the connection; short enough that a tab left open
 * overnight is not holding a socket and a 1 Hz stream nobody is reading.
 */
const HIDDEN_GRACE_MS = 60_000;

export type MarketFeedValue = FeedState & {
  /**
   * The connection is up but has gone quiet for longer than `STALE_AFTER_MS`.
   *
   * The price poller drives a depth broadcast at ~1 Hz per market, so silence
   * is a fault and not a quiet market (§7.5). This is separate from `source`
   * because it is a different claim: `reconnecting` means we know the socket is
   * gone, `stale` means it says it is open and nothing is coming through it.
   */
  stale: boolean;
};

const MarketFeedContext = createContext<MarketFeedValue | null>(null);

export function useMarketFeed(): MarketFeedValue {
  const value = useContext(MarketFeedContext);
  if (!value) {
    throw new Error("useMarketFeed must be used inside <MarketFeedProvider>");
  }
  return value;
}

/**
 * The same context read from outside the terminal.
 *
 * `PositionsProvider` spans every market and mounts above the shell, so it can
 * be rendered with no feed at all; where there is one it upgrades the mark of
 * the market on screen from a REST snapshot to the live book. See the note
 * there.
 */
export function useMarketFeedOptional(): MarketFeedValue | null {
  return useContext(MarketFeedContext);
}

export function MarketFeedProvider({
  market,
  children,
  staleAfterMs = STALE_AFTER_MS,
}: {
  market: Market;
  children: React.ReactNode;
  /**
   * Overridable only so the silence rule itself can be tested in milliseconds
   * rather than in five real seconds. Nothing in the app passes it.
   */
  staleAfterMs?: number;
}) {
  const [state, setState] = useState<FeedState>(() => initialMachine().state);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const machine = { current: initialMachine() };
    const commit = (next: Machine) => {
      machine.current = next;
      setState(next.state);
    };
    commit(initialMachine());
    setStale(false);

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    /** Bumped on every teardown so a resolving snapshot from the previous
     *  connection cannot be applied to the current one. */
    let generation = 0;
    let stopped = false;

    const teardown = () => {
      generation++;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (socket) {
        // Drop the handlers first: `close()` fires `onclose`, which would
        // otherwise schedule a reconnect for a connection we are abandoning.
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
        socket = null;
      }
    };

    /** A drop we intend to recover from. Idempotent: onerror and onclose both fire. */
    const fail = () => {
      if (stopped || socket === null) return;
      teardown();
      commit(onDisconnect(machine.current, true));
      retryTimer = setTimeout(connect, backoffDelay(attempt++));
      // Nothing has ever been shown for this market and the socket is not
      // coming up: fall back to one REST read so the ladder is a real book
      // labelled `reconnecting`, rather than a skeleton that shimmers forever.
      if (machine.current.state.depth === null) void coldSnapshot(generation);
    };

    async function coldSnapshot(mine: number) {
      try {
        const depth = await getDepth(market.id);
        if (stopped || mine !== generation) return;
        commit(onColdSnapshot(machine.current, depth));
      } catch {
        // The backend is down too. The retry above is already scheduled and
        // will try both again; there is nothing to show and nothing to say
        // beyond what the status dot is already saying.
      }
    }

    async function snapshot(mine: number) {
      try {
        const depth = await getDepth(market.id);
        if (stopped || mine !== generation) return;
        commit(onSnapshot(machine.current, depth));
      } catch {
        // The socket may be perfectly healthy, but without a snapshot there is
        // no baseline to reconcile against and every frame is still buffered —
        // so this is a connection fault and takes the reconnect path.
        if (stopped || mine !== generation) return;
        fail();
      }
    }

    function connect() {
      if (stopped) return;
      retryTimer = null;
      if (attempt > 0) commit(onRetrying(machine.current));

      const url = `${WS_URL}?feeds=${FEEDS}&market_id=${encodeURIComponent(market.id)}`;
      try {
        socket = new WebSocket(url);
      } catch {
        // Constructing a socket throws only on a malformed URL, which no retry
        // will fix — but the backoff cap makes retrying cheap, and giving up
        // here would need a fifth source state to explain itself.
        socket = null;
        commit(onDisconnect(machine.current, true));
        retryTimer = setTimeout(connect, backoffDelay(attempt++));
        return;
      }

      const mine = generation;

      socket.onopen = () => {
        if (stopped || mine !== generation) return;
        // Reset only on a socket that actually opened. Resetting when one is
        // merely constructed would turn the backoff into a fixed 250 ms retry
        // against a server that is refusing connections.
        attempt = 0;
        commit(onOpen(machine.current));
        void snapshot(mine);
      };

      socket.onmessage = (event) => {
        if (stopped || mine !== generation) return;
        const frame = parseFrame(String(event.data), market.id);
        // A malformed or irrelevant frame is dropped, never a teardown.
        if (!frame) return;
        commit(onFrame(machine.current, frame, Date.now()));
      };

      socket.onerror = fail;
      socket.onclose = fail;
    }

    /**
     * A hidden tab is dropped after a grace period and resynchronised on
     * return. The resync is not an optimisation — a book left on screen for an
     * hour with no socket is exactly the stale-data problem this phase exists
     * to remove, so coming back re-runs the full snapshot path.
     */
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenTimer = setTimeout(() => {
          teardown();
          commit(onDisconnect(machine.current, false));
        }, HIDDEN_GRACE_MS);
        return;
      }
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = null;
      if (socket === null && retryTimer === null) {
        attempt = 0;
        connect();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    connect();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      teardown();
    };
  }, [market.id]);

  /**
   * Staleness, driven by the arrival of frames rather than by polling: each
   * frame re-arms one timer. `lastFrameAt` only changes when something actually
   * arrives, so this effect does not re-run on an unrelated render.
   */
  useEffect(() => {
    setStale(false);
    if (state.source !== "live" || state.lastFrameAt === null) return;
    const id = setTimeout(() => setStale(true), staleAfterMs);
    return () => clearTimeout(id);
  }, [state.lastFrameAt, state.source, staleAfterMs]);

  const value = useMemo<MarketFeedValue>(
    () => ({ ...state, stale: stale && state.source === "live" }),
    [state, stale],
  );

  return (
    <MarketFeedContext.Provider value={value}>
      {children}
    </MarketFeedContext.Provider>
  );
}
