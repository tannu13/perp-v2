"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { getWsTicket } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session-provider";
import { backoffDelay } from "@/lib/market-feed-core";
import { parseUserFrame, type UserEvent } from "@/lib/user-feed-core";

export type { UserEvent } from "@/lib/user-feed-core";

/**
 * The private user channel — the socket half.
 *
 * The account's own fills, order transitions, position changes and
 * liquidations, pushed. This is the largest gap the integration had (G19, G8):
 * before it, a **maker** — whose resting order is hit by someone else, who
 * submitted nothing at that moment and has no response to read — could only
 * learn that they had traded by asking again, and nothing told them when.
 *
 * **A second socket, not a second subscription on the market feed.** The two
 * have different lifetimes and different scopes, and merging them would give
 * the shorter-lived one's rules to the longer-lived one. `MarketFeedProvider`
 * is keyed on the market and tears its socket down on every market switch,
 * because ws-server settles the market at the HTTP upgrade and has no
 * client→server protocol to change it. Nothing about the account is
 * market-scoped, and dropping the private channel — with its resynchronisation
 * — every time the user looks at a different chart would be an odd thing to do
 * on purpose. It also mounts higher: this provider sits in the root layout
 * above `AccountProvider`, because balances are app-wide and the terminal is
 * not the only place they are shown.
 *
 * **The credential is a ticket, and the reason is D1.** The session token
 * lives in an httpOnly cookie on the API host, so browser JavaScript cannot
 * read it — which rules out §6.14's branch A ("send the JWT itself") outright.
 * A WebSocket handshake carries no custom headers either, so the only channel
 * left is the URL. `POST /ws-ticket` mints a sixty-second, `typ: "ws"`
 * credential for exactly that: it is refused by the REST API, and a copy of it
 * scraped out of a proxy log an hour later opens nothing.
 */

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3010";

/** Same grace as the market feed: flipping tabs must not churn the socket. */
const HIDDEN_GRACE_MS = 60_000;

/**
 * A buffer this deep would take a very unusual burst to fill while three
 * snapshot requests are in flight. It is a bound on a wedged resync, not a
 * tuning knob — and dropping the newest events is the right overflow
 * behaviour here, because the snapshot being awaited is newer than all of them.
 */
const MAX_BUFFER = 256;

/**
 * What the channel is doing.
 *
 *   idle           nobody is signed in; there is nothing to subscribe to
 *   connecting     first attempt, or a ticket being fetched
 *   syncing        socket open, snapshots in flight, events buffering
 *   live           snapshots applied, events applying as they arrive
 *   reconnecting   dropped, retry scheduled — state on screen is a snapshot
 *   disconnected   given up (tab hidden long enough, or unmounted)
 *
 * `syncing` is distinct from `live` deliberately: during it the tables hold
 * state that is about to be replaced, and an event that has already arrived
 * has not been applied yet. Phase 13 kept it separate so that Phase 14 could
 * decide whether to say it; Phase 14 decided that it should, and
 * `AccountFeedStatus` in the header gives all six states a word.
 */
export type UserFeedStatus =
  | "idle"
  | "connecting"
  | "syncing"
  | "live"
  | "reconnecting"
  | "disconnected";

/**
 * What a state owner registers with the channel.
 *
 * `resync` runs on **every** (re)connect, before any event is delivered, and
 * the channel waits for all of them. That is the same snapshot-then-drain
 * ordering the depth feed uses (§7.3) and it is what makes a reconnect safe:
 * events that arrived while the snapshot was in flight are replayed over it,
 * and the ones the snapshot already contains change nothing because every
 * event is absolute and `supersedes` guards the two that are not.
 *
 * `onEvents` receives the whole batch one engine reply produced for this
 * account. Subscribers are handed every event and ignore what is not theirs —
 * **one owner per entity**, so exactly one of them acts on any given type.
 */
export type UserFeedSubscriber = {
  resync?: () => Promise<void>;
  onEvents: (events: UserEvent[]) => void;
};

type UserFeedValue = {
  status: UserFeedStatus;
  /** Bumped on every completed resync. A test hook, and a debugging one. */
  generation: number;
};

const UserFeedContext = createContext<UserFeedValue | null>(null);
const SubscribersContext = createContext<Set<{ current: UserFeedSubscriber }> | null>(
  null,
);

/**
 * Reads the channel's status. Returns `idle` where there is no provider, which
 * is the honest answer on a page that mounts none.
 */
export function useUserFeedStatus(): UserFeedStatus {
  return useContext(UserFeedContext)?.status ?? "idle";
}

/**
 * Registers a state owner with the channel.
 *
 * The subscriber is held in a ref that is updated on every render, so a
 * provider whose `load` is a `useCallback` with changing dependencies does not
 * re-register — and, more to the point, does not miss events during the render
 * in which its identity changed.
 *
 * A no-op where there is no provider: `AccountProvider` renders on the landing
 * page too, and a hook that threw there would make the channel's placement a
 * constraint on every page in the app.
 */
export function useUserFeedSubscription(subscriber: UserFeedSubscriber) {
  const subscribers = useContext(SubscribersContext);
  const ref = useRef(subscriber);
  ref.current = subscriber;

  useEffect(() => {
    if (!subscribers) return;
    subscribers.add(ref);
    return () => {
      subscribers.delete(ref);
    };
  }, [subscribers]);
}

export function UserFeedProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const [value, setValue] = useState<UserFeedValue>({
    status: "idle",
    generation: 0,
  });

  /**
   * Stable for the life of the provider. Subscribers add and remove
   * themselves; the socket effect reads it. It is deliberately NOT state —
   * a provider mounting must not re-run the connection effect.
   */
  const subscribersRef = useRef<Set<{ current: UserFeedSubscriber }>>(new Set());

  const userId = session.identity?.userId ?? null;

  useEffect(() => {
    if (!userId) {
      setValue({ status: "idle", generation: 0 });
      return;
    }

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    /** Bumped on every teardown, so work from an abandoned connection lands nowhere. */
    let generation = 0;
    let stopped = false;
    let buffering = false;
    let buffer: UserEvent[] = [];

    const setStatus = (status: UserFeedStatus) =>
      setValue((prev) => (prev.status === status ? prev : { ...prev, status }));

    const dispatch = (events: UserEvent[]) => {
      // A copy, because a subscriber unmounting inside its own handler would
      // otherwise mutate the set being iterated.
      for (const ref of [...subscribersRef.current]) ref.current.onEvents(events);
    };

    const teardown = () => {
      generation++;
      buffering = false;
      buffer = [];
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (socket) {
        // Handlers first: `close()` fires `onclose`, which would otherwise
        // schedule a reconnect for a connection we are abandoning.
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
      setStatus("reconnecting");
      retryTimer = setTimeout(() => void connect(), backoffDelay(attempt++));
    };

    /**
     * The snapshot half of snapshot-then-drain.
     *
     * `allSettled`, not `all`: one entity's snapshot failing must not leave
     * the other two buffering forever. A subscriber whose resync rejected is
     * showing its own error state and will be resynchronised on the next
     * reconnect; the ones that succeeded should go live now.
     */
    async function resyncAndDrain(mine: number) {
      const resyncs = [...subscribersRef.current]
        .map((ref) => ref.current.resync)
        .filter((fn): fn is () => Promise<void> => typeof fn === "function");

      await Promise.allSettled(resyncs.map((fn) => fn()));
      if (stopped || mine !== generation) return;

      const pending = buffer;
      buffer = [];
      buffering = false;
      if (pending.length) dispatch(pending);

      setValue((prev) => ({
        status: "live",
        generation: prev.generation + 1,
      }));
    }

    async function connect() {
      if (stopped) return;
      retryTimer = null;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");

      const mine = generation;

      /**
       * The ticket is fetched per attempt, not once.
       *
       * It lives sixty seconds, so one cached at the first attempt would be
       * long dead by the time an exponential backoff reached its cap — and a
       * reconnect storm after a ws-server restart is exactly when this path
       * runs most.
       */
      let ticket: string;
      try {
        ticket = (await getWsTicket()).ticket;
      } catch (err) {
        if (stopped || mine !== generation) return;

        /**
         * An expired session ends the loop rather than backing off through it.
         *
         * Phase 14 (D17's neighbour). This provider fetches a ticket on every
         * connection attempt, so a session that expires while the socket is
         * down produces a failing `/ws-ticket` on every tick of the backoff —
         * each one a 401, each one arriving at the interceptor. The latch in
         * `http.ts` collapses a concurrent burst, not a schedule, so what the
         * user would see is a sign-in page raising the same toast every few
         * seconds. There is nothing to reconnect to without a session: stop,
         * and let the identity change re-run this effect if they sign in
         * again.
         */
        if (err instanceof ApiError && err.isSilent) {
          teardown();
          setStatus("disconnected");
          return;
        }

        // The API is down. Same schedule as a dropped socket.
        setStatus("reconnecting");
        retryTimer = setTimeout(() => void connect(), backoffDelay(attempt++));
        return;
      }
      if (stopped || mine !== generation) return;

      try {
        socket = new WebSocket(`${WS_URL}?ticket=${encodeURIComponent(ticket)}`);
      } catch {
        socket = null;
        setStatus("reconnecting");
        retryTimer = setTimeout(() => void connect(), backoffDelay(attempt++));
        return;
      }

      socket.onopen = () => {
        if (stopped || mine !== generation) return;
        // Reset only on a socket that actually opened — see the same note on
        // the market feed. Buffering starts here rather than when the first
        // snapshot request is issued: the window between the two is precisely
        // what buffering exists to cover.
        attempt = 0;
        buffering = true;
        buffer = [];
        setStatus("syncing");
        void resyncAndDrain(mine);
      };

      socket.onmessage = (event) => {
        if (stopped || mine !== generation) return;
        const events = parseUserFrame(String(event.data));
        // A malformed frame is dropped, never a teardown: the socket is shared
        // with the frames after it.
        if (!events || events.length === 0) return;

        if (buffering) {
          if (buffer.length < MAX_BUFFER) buffer.push(...events);
          return;
        }
        dispatch(events);
      };

      socket.onerror = fail;
      socket.onclose = fail;
    }

    /**
     * A hidden tab drops the socket after a grace period and resynchronises on
     * return — and here the resync is the point, not an optimisation. Coming
     * back to a tab left open for an hour runs the full snapshot path, which is
     * what replaces the focus listeners the providers used to carry.
     */
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenTimer = setTimeout(() => {
          teardown();
          setStatus("disconnected");
        }, HIDDEN_GRACE_MS);
        return;
      }
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = null;
      if (socket === null && retryTimer === null) {
        attempt = 0;
        void connect();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    void connect();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      teardown();
    };
  }, [userId]);

  return (
    <SubscribersContext.Provider value={subscribersRef.current}>
      <UserFeedContext.Provider value={value}>{children}</UserFeedContext.Provider>
    </SubscribersContext.Provider>
  );
}
