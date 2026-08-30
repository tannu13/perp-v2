import { z } from "zod";
import { MarketDepthSchema } from "@repo/shared";

/**
 * The market feed, minus the I/O.
 *
 * Everything here is pure: parsing a frame, the reconciliation state machine
 * and the backoff schedule. `market-feed.tsx` owns the socket, the timers and
 * React; it holds one `Machine` in a ref and hands every event to the functions
 * below. That split is what makes "a frame arrived before the snapshot
 * resolved" a unit test rather than a stopwatch.
 *
 * **There is no simulator any more.** The previous version of this file
 * invented a book, a price and a trade tape whenever the socket was slow, and
 * surfaced it as `source: "simulated"`. Nothing in this module can produce a
 * number the server did not send — see G21 in the integration plan. If the feed
 * is down, `depth` is whatever the server last said and `source` says so.
 */

export type DepthLevel = [price: string, qty: string];

export type Depth = {
  market: string;
  lastUpdateId: number;
  timestamp: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
};

export type Trade = {
  id: string;
  price: string;
  qty: string;
  side: "buy" | "sell";
  ts: number;
};

/**
 * Four states, none of which is "made up".
 *
 *   connecting     first socket of this market; no snapshot applied yet
 *   live           snapshot applied and the socket is open
 *   reconnecting   the socket dropped and a retry is scheduled — the ladder on
 *                  screen is the last thing the server said, and is marked stale
 *   disconnected   retries have been given up on (tab hidden, or unmount)
 */
export type FeedSource = "connecting" | "live" | "reconnecting" | "disconnected";

export type FeedState = {
  depth: Depth | null;
  trades: Trade[];
  lastPrice: number | null;
  prevPrice: number | null;
  /**
   * The exchange's index price — the spot price apps/price-poller reads off
   * Binance and hands the engine, which is what liquidations are evaluated
   * against.
   *
   * Null until a frame carries one. It is deliberately NOT the mid of the book
   * that the Positions tab marks against: those are two different numbers with
   * two different jobs, and the market bar labels this one accordingly.
   */
  markPrice: number | null;
  source: FeedSource;
  /**
   * When the last frame was *received* (not applied). The price poller drives a
   * depth broadcast at ~1 Hz per market, so silence is a fault rather than a
   * quiet market — §7.5. `null` means nothing has arrived yet on this
   * connection, which is not the same as stale.
   */
  lastFrameAt: number | null;
};

/**
 * Whether the exchange publishes a public tape at all.
 *
 * True since Phase 12: the engine emits a print for every fill a match
 * produced and ws-server relays them to `feed:{marketId}:trades` (G16 closed).
 * The flag survives because the distinction it draws is a real one and the
 * pane's copy depends on it — "no public trade tape" is a different statement
 * from "nothing has traded yet", and only one of them is ever true.
 */
export const TRADES_PUBLISHED = true;

/** How long without a frame before the connection is treated as faulty. */
export const STALE_AFTER_MS = 5_000;

const MAX_TRADES = 40;

/**
 * A buffer this deep only fills if the snapshot fetch takes ~200 seconds at the
 * poller's 1 Hz, by which point the fetch has long since failed. It exists so a
 * wedged fetch cannot grow an unbounded array, not as a tuning knob.
 */
const MAX_BUFFER = 256;

const TradeFrameSchema = z.object({
  id: z.string(),
  price: z.string(),
  qty: z.string(),
  side: z.enum(["buy", "sell"]),
  ts: z.coerce.number(),
});

export type Frame =
  | { kind: "depth"; depth: Depth }
  | { kind: "last-traded-price"; price: number }
  | { kind: "mark-price"; price: number }
  | { kind: "trade"; trade: Trade };

/** `last-traded-price` and `mark-price` carry the same one-field payload. */
const PriceFrameSchema = z.object({ price: z.union([z.string(), z.number()]) });

/**
 * One socket message → a frame, or null.
 *
 * Null covers everything that must not disturb the feed: the `{ type: "system" }`
 * subscribe acknowledgement, a feed we do not consume, a frame for a market we
 * are not showing, and anything malformed. A malformed frame must never tear
 * down the connection — the socket is shared with the frames that follow it.
 *
 * Payloads are parsed with the same schema the REST snapshot uses rather than
 * cast, for the Phase 3 reason: `GET /depth` and `feed:{id}:depth` are
 * literally the same object, and the one place it becomes typed should be the
 * one place it is validated.
 */
export function parseFrame(raw: string, marketId: string): Frame | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;

  const envelope = msg as { type?: unknown; feed?: unknown; marketId?: unknown; data?: unknown };
  if (envelope.type === "system") return null;

  /**
   * A frame for another market is dropped, not rendered. The socket carries one
   * market's topics, so this should be unreachable — but a market switch that
   * raced a teardown would otherwise merge two books into one ladder, which is
   * the one failure mode of this pane that looks plausible on screen.
   */
  if (typeof envelope.marketId === "string" && envelope.marketId !== marketId) {
    return null;
  }

  switch (envelope.feed) {
    case "depth": {
      const parsed = MarketDepthSchema.safeParse(envelope.data);
      if (!parsed.success) return null;
      // `market` on the payload is the engine's own id for the book.
      if (parsed.data.market !== marketId) return null;
      return { kind: "depth", depth: parsed.data };
    }
    case "last-traded-price": {
      const parsed = PriceFrameSchema.safeParse(envelope.data);
      if (!parsed.success) return null;
      const price = Number(parsed.data.price);
      if (!Number.isFinite(price)) return null;
      return { kind: "last-traded-price", price };
    }
    /**
     * Parsed again as of Phase 12.
     *
     * This case was deliberately deleted in Phase 11: the engine never assigned
     * `orderbook.indexPrice`, so the feed broadcast the seed (85 / 1850 / 4930)
     * for the life of the process, and dropping the frame here was what made it
     * structurally impossible for that number to reach a component. The engine
     * now writes the spot price it is handed on every tick (G15 closed), so the
     * frame carries something true and the market bar can show it.
     *
     * Zero is rejected along with the non-numbers: a book has no index of zero,
     * and rendering one as a price would be the same class of claim the em dash
     * existed to avoid.
     */
    case "mark-price": {
      const parsed = PriceFrameSchema.safeParse(envelope.data);
      if (!parsed.success) return null;
      const price = Number(parsed.data.price);
      if (!Number.isFinite(price) || price <= 0) return null;
      return { kind: "mark-price", price };
    }
    case "trades": {
      const parsed = TradeFrameSchema.safeParse(envelope.data);
      if (!parsed.success) return null;
      return { kind: "trade", trade: parsed.data };
    }
    default:
      return null;
  }
}

/**
 * The reconciliation machine.
 *
 * The ordering that must hold (§7.3): subscribe → buffer → snapshot → apply
 * snapshot → drain the buffer discarding anything `<= snapshot.lastUpdateId` →
 * go live.
 */
export type Machine = {
  state: FeedState;
  /** Frames received while the REST snapshot is in flight. */
  buffer: Frame[];
  /** True from socket open until the snapshot has been applied. */
  buffering: boolean;
};

export function initialMachine(): Machine {
  return {
    state: {
      depth: null,
      trades: [],
      lastPrice: null,
      prevPrice: null,
      markPrice: null,
      source: "connecting",
      lastFrameAt: null,
    },
    buffer: [],
    buffering: false,
  };
}

/**
 * Applies one frame to the state.
 *
 * The depth guard is `frame.lastUpdateId > applied.lastUpdateId` and nothing
 * else. `lastUpdateId` is a single counter on the engine's store, shared across
 * every market (G20), so it can order frames and reject stale ones but cannot
 * detect a gap — and does not need to, because a depth frame is a full 20-level
 * snapshot rather than a delta. A missed frame is self-healing on the next tick.
 *
 * The same guard is what drains the buffer: applying the REST snapshot first
 * and then replaying buffered frames through this function discards exactly the
 * ones the snapshot already contains.
 */
function applyFrame(state: FeedState, frame: Frame): FeedState {
  switch (frame.kind) {
    case "depth": {
      if (state.depth && frame.depth.lastUpdateId <= state.depth.lastUpdateId) {
        return state;
      }
      return { ...state, depth: frame.depth };
    }
    case "last-traded-price":
      // prevPrice drives the ladder's tick colour, so it is the price this one
      // replaced — not the price two ticks ago.
      return { ...state, prevPrice: state.lastPrice, lastPrice: frame.price };
    case "mark-price":
      return { ...state, markPrice: frame.price };
    case "trade":
      return {
        ...state,
        trades: [frame.trade, ...state.trades].slice(0, MAX_TRADES),
      };
  }
}

/**
 * The socket opened. Buffering starts here, not when the snapshot request is
 * issued: the window between the two is exactly what buffering exists to cover.
 */
export function onOpen(m: Machine): Machine {
  return { ...m, buffer: [], buffering: true };
}

/**
 * A frame arrived. `now` is passed in rather than read from the clock so the
 * staleness timer is testable.
 */
export function onFrame(m: Machine, frame: Frame, now: number): Machine {
  // Liveness is about traffic, so it counts frames received — including ones
  // the guard below will discard as stale.
  const state = { ...m.state, lastFrameAt: now };

  if (m.buffering) {
    return {
      ...m,
      state,
      buffer: m.buffer.length >= MAX_BUFFER ? m.buffer : [...m.buffer, frame],
    };
  }
  return { ...m, state: applyFrame(state, frame) };
}

/**
 * The REST snapshot resolved. It replaces the book unconditionally — no frame
 * has been applied since `onOpen`, so it is the newest thing we hold — and then
 * the buffer drains through the ordinary guard.
 */
export function onSnapshot(m: Machine, depth: Depth): Machine {
  let state: FeedState = { ...m.state, depth, source: "live" };
  for (const frame of m.buffer) state = applyFrame(state, frame);
  return { state, buffer: [], buffering: false };
}

/**
 * The socket closed, errored, or the snapshot fetch failed.
 *
 * **The book on screen is kept.** It is the last thing the server actually
 * said; blanking it would trade a stale truth for no information, and the
 * status dot is what tells the user which it is. What is dropped is the buffer,
 * because the next connection re-snapshots from REST and buffered frames from
 * before a drop can only be older than that snapshot.
 */
export function onDisconnect(m: Machine, willRetry: boolean): Machine {
  return {
    state: { ...m.state, source: willRetry ? "reconnecting" : "disconnected" },
    buffer: [],
    buffering: false,
  };
}

/**
 * A REST snapshot applied while the socket is NOT up.
 *
 * This is the "ws-server is down but the backend is not" case. Without it the
 * first load of a terminal whose socket never opens sits on a shimmering
 * skeleton forever — claiming data is on its way when nothing is coming — even
 * though `GET /depth` would have answered immediately. The book it applies is
 * real and the status dot still says `reconnecting`, so it is a labelled
 * snapshot rather than a live feed, which is the distinction this phase is
 * about.
 *
 * It refuses to run while buffering or once the feed is live: in both cases a
 * socket has come up in the meantime and owns the book, and this read — issued
 * before that happened — can only be older than what is already on screen.
 */
export function onColdSnapshot(m: Machine, depth: Depth): Machine {
  if (m.buffering || m.state.source === "live") return m;
  return { ...m, state: { ...m.state, depth } };
}

/** A retry is being attempted. Distinct from `onOpen`: the socket is not up yet. */
export function onRetrying(m: Machine): Machine {
  return { ...m, state: { ...m.state, source: "reconnecting" }, buffering: false };
}

/**
 * Exponential backoff with full jitter, 250 ms doubling to an 8 s cap.
 *
 * Jitter is not decoration: every tab on this market drops at the same instant
 * when ws-server restarts, and an unjittered schedule reconnects all of them
 * together, repeatedly. The delay is drawn from [base/2, base) so it always
 * grows with the attempt count while never being the same for two clients.
 *
 * `attempt` is zero-based and is reset by the caller on a clean open.
 */
export const BACKOFF_BASE_MS = 250;
export const BACKOFF_CAP_MS = 8_000;

/**
 * The jitter source, and the reason it is not the standard PRNG.
 *
 * Phase 11's acceptance criterion is a grep for that PRNG across `apps/web/lib`
 * coming back empty — the point being that nothing under `lib/` can invent a
 * number a user might read as market data. A timer delay is not market data, so
 * an exception would be harmless in itself, and would also make the grep stop
 * meaning anything. Keeping the check absolute costs one line.
 */
function jitter(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

export function backoffDelay(attempt: number, rng: () => number = jitter) {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt), BACKOFF_CAP_MS);
  return Math.round(base / 2 + rng() * (base / 2));
}
