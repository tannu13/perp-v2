import { describe, expect, it } from "bun:test";
import {
  BACKOFF_CAP_MS,
  backoffDelay,
  initialMachine,
  onColdSnapshot,
  onDisconnect,
  onFrame,
  onOpen,
  onRetrying,
  onSnapshot,
  parseFrame,
  type Depth,
  type Machine,
} from "./market-feed-core";

/**
 * The reconciliation rules, tested without a socket.
 *
 * The ordering this file exists to pin down is §7.3's: subscribe → buffer →
 * snapshot → apply snapshot → drain the buffer discarding anything the snapshot
 * already contains → go live. Every one of those steps is a race in the real
 * transport and none of them is observable from the outside, which is why the
 * machine is pure and the provider only wires events to it.
 */

const MARKET = "e3289213-372c-44d2-8cc8-2a6eb55b11b1";
const OTHER = "e59931c4-c54a-435f-8c57-382fa60fca58";

const depth = (lastUpdateId: number, bid = "100"): Depth => ({
  market: MARKET,
  lastUpdateId,
  timestamp: 1_756_000_000_000,
  bids: [[bid, "5"]],
  asks: [["101", "5"]],
});

const depthFrame = (lastUpdateId: number, bid?: string) =>
  JSON.stringify({ feed: "depth", marketId: MARKET, data: depth(lastUpdateId, bid) });

/** Parses and applies in one step, so the tests read as "a frame arrived". */
function receive(m: Machine, raw: string, now = 1): Machine {
  const frame = parseFrame(raw, MARKET);
  return frame ? onFrame(m, frame, now) : m;
}

describe("parseFrame", () => {
  it("ignores the subscribe acknowledgement", () => {
    const raw = JSON.stringify({ type: "system", message: "Auto-subscribed to depth" });
    expect(parseFrame(raw, MARKET)).toBeNull();
  });

  it("ignores a frame for another market", () => {
    const raw = JSON.stringify({ feed: "depth", marketId: OTHER, data: depth(1) });
    expect(parseFrame(raw, MARKET)).toBeNull();
  });

  it("ignores a depth payload whose own market disagrees with the envelope", () => {
    const raw = JSON.stringify({
      feed: "depth",
      marketId: MARKET,
      data: { ...depth(1), market: OTHER },
    });
    expect(parseFrame(raw, MARKET)).toBeNull();
  });

  it("returns null for malformed JSON rather than throwing", () => {
    expect(parseFrame("{not json", MARKET)).toBeNull();
    expect(parseFrame("", MARKET)).toBeNull();
  });

  it("returns null for a depth frame missing its levels", () => {
    const raw = JSON.stringify({
      feed: "depth",
      marketId: MARKET,
      data: { market: MARKET, lastUpdateId: 1, timestamp: 1 },
    });
    expect(parseFrame(raw, MARKET)).toBeNull();
  });

  it("parses a depth frame", () => {
    const frame = parseFrame(depthFrame(7), MARKET);
    expect(frame).toEqual({ kind: "depth", depth: depth(7) });
  });

  it("parses a last-traded-price frame, string or number", () => {
    const asString = JSON.stringify({
      feed: "last-traded-price",
      marketId: MARKET,
      data: { price: "90.5" },
    });
    const asNumber = JSON.stringify({
      feed: "last-traded-price",
      marketId: MARKET,
      data: { price: 90.5 },
    });
    expect(parseFrame(asString, MARKET)).toEqual({ kind: "last-traded-price", price: 90.5 });
    expect(parseFrame(asNumber, MARKET)).toEqual({ kind: "last-traded-price", price: 90.5 });
  });

  /**
   * G15 closed. This frame used to be dropped on purpose: the engine never
   * assigned `orderbook.indexPrice`, so the feed carried the seed (85 for SOL)
   * for the life of the process, and refusing to parse it was what guaranteed
   * no component could render a number that had never been true. The engine
   * writes the spot price it is handed on every tick now.
   */
  it("parses a mark-price frame, string or number", () => {
    const raw = (price: unknown) =>
      JSON.stringify({ feed: "mark-price", marketId: MARKET, data: { price } });

    expect(parseFrame(raw("212.5"), MARKET)).toEqual({
      kind: "mark-price",
      price: 212.5,
    });
    expect(parseFrame(raw(212.5), MARKET)).toEqual({
      kind: "mark-price",
      price: 212.5,
    });
  });

  it("rejects an index of zero rather than rendering one", () => {
    // No book has an index of zero, so a zero is a fault upstream — and it
    // would print as a price, which is the exact claim the em dash exists to
    // avoid making.
    const raw = (price: unknown) =>
      JSON.stringify({ feed: "mark-price", marketId: MARKET, data: { price } });

    expect(parseFrame(raw(0), MARKET)).toBeNull();
    expect(parseFrame(raw("not a price"), MARKET)).toBeNull();
    expect(parseFrame(raw(undefined), MARKET)).toBeNull();
  });
});

describe("snapshot reconciliation", () => {
  it("buffers frames that arrive while the snapshot is in flight", () => {
    let m = onOpen(initialMachine());
    m = receive(m, depthFrame(11));
    m = receive(m, depthFrame(12));

    // Nothing is applied yet: the snapshot is the baseline, and applying a
    // frame before it would be replaced a moment later anyway.
    expect(m.state.depth).toBeNull();
    expect(m.buffer).toHaveLength(2);
    expect(m.state.source).toBe("connecting");
  });

  it("applies the snapshot, then drains only the frames newer than it", () => {
    let m = onOpen(initialMachine());
    m = receive(m, depthFrame(9, "99"));
    m = receive(m, depthFrame(12, "112"));

    m = onSnapshot(m, depth(10, "110"));

    // 9 is older than the snapshot and is discarded; 12 is newer and wins.
    expect(m.state.depth?.lastUpdateId).toBe(12);
    expect(m.state.depth?.bids[0]?.[0]).toBe("112");
    expect(m.buffer).toHaveLength(0);
    expect(m.buffering).toBe(false);
    expect(m.state.source).toBe("live");
  });

  it("keeps the snapshot when every buffered frame predates it", () => {
    let m = onOpen(initialMachine());
    m = receive(m, depthFrame(3, "103"));
    m = onSnapshot(m, depth(10, "110"));

    expect(m.state.depth?.lastUpdateId).toBe(10);
    expect(m.state.depth?.bids[0]?.[0]).toBe("110");
  });

  it("goes live and applies frames directly once the snapshot has landed", () => {
    let m = onSnapshot(onOpen(initialMachine()), depth(10));
    m = receive(m, depthFrame(11, "111"));

    expect(m.buffer).toHaveLength(0);
    expect(m.state.depth?.bids[0]?.[0]).toBe("111");
  });

  it("rejects a stale depth frame after going live", () => {
    let m = onSnapshot(onOpen(initialMachine()), depth(20, "120"));
    m = receive(m, depthFrame(19, "119"));

    // The guard is `>` and nothing else: lastUpdateId is one global counter, so
    // it can order frames but cannot detect a gap (G20).
    expect(m.state.depth?.lastUpdateId).toBe(20);
    expect(m.state.depth?.bids[0]?.[0]).toBe("120");
  });

  it("re-snapshots on a reconnect without losing the frames that arrive first", () => {
    let m = onSnapshot(onOpen(initialMachine()), depth(10));
    m = onDisconnect(m, true);
    expect(m.state.source).toBe("reconnecting");
    // The last book the server sent stays on screen — frozen, not blanked.
    expect(m.state.depth?.lastUpdateId).toBe(10);

    m = onOpen(onRetrying(m));
    m = receive(m, depthFrame(31, "131"));
    expect(m.state.depth?.lastUpdateId).toBe(10);

    m = onSnapshot(m, depth(30, "130"));
    expect(m.state.depth?.lastUpdateId).toBe(31);
    expect(m.state.source).toBe("live");
  });

  it("drops the buffer on a disconnect, because the next snapshot supersedes it", () => {
    let m = onOpen(initialMachine());
    m = receive(m, depthFrame(11));
    m = onDisconnect(m, true);
    expect(m.buffer).toHaveLength(0);
    expect(m.buffering).toBe(false);
  });

  it("shows a REST book while the socket is down, without claiming to be live", () => {
    // ws-server down, backend up. The alternative is a skeleton that shimmers
    // forever while `GET /depth` would have answered immediately.
    let m = onDisconnect(onOpen(initialMachine()), true);
    m = onColdSnapshot(m, depth(10, "110"));

    expect(m.state.depth?.bids[0]?.[0]).toBe("110");
    expect(m.state.source).toBe("reconnecting");
  });

  it("ignores a cold snapshot that lands after the socket came back", () => {
    // The REST read was issued before the reconnect and can only be older than
    // the book the live socket is already holding.
    let m = onSnapshot(onOpen(initialMachine()), depth(30, "130"));
    m = onColdSnapshot(m, depth(10, "110"));
    expect(m.state.depth?.lastUpdateId).toBe(30);

    // Same during a re-snapshot: the buffering path owns the baseline.
    const buffering = onOpen(m);
    expect(onColdSnapshot(buffering, depth(11, "111")).state.depth?.lastUpdateId).toBe(30);
  });

  it("distinguishes a retry from giving up", () => {
    const m = onSnapshot(onOpen(initialMachine()), depth(1));
    expect(onDisconnect(m, true).state.source).toBe("reconnecting");
    expect(onDisconnect(m, false).state.source).toBe("disconnected");
  });
});

describe("prices and prints", () => {
  it("moves the previous price to prevPrice on each tick", () => {
    let m = onSnapshot(onOpen(initialMachine()), depth(1));
    const ltp = (price: string) =>
      JSON.stringify({ feed: "last-traded-price", marketId: MARKET, data: { price } });

    m = receive(m, ltp("100"));
    expect(m.state).toMatchObject({ lastPrice: 100, prevPrice: null });

    m = receive(m, ltp("101"));
    expect(m.state).toMatchObject({ lastPrice: 101, prevPrice: 100 });
  });

  it("prepends trades, newest first", () => {
    let m = onSnapshot(onOpen(initialMachine()), depth(1));
    const trade = (id: string) =>
      JSON.stringify({
        feed: "trades",
        marketId: MARKET,
        data: { id, price: "100", qty: "1", side: "buy", ts: 1 },
      });

    m = receive(m, trade("t1"));
    m = receive(m, trade("t2"));
    expect(m.state.trades.map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  it("holds the index price apart from the last trade", () => {
    // Two prices with two jobs: what the book last traded at, and the spot
    // index the engine liquidates against. Neither may overwrite the other —
    // on a book this suite has left at four dollars they differ by a factor of
    // fifty, and each is right about a different question.
    let m = onSnapshot(onOpen(initialMachine()), depth(1));
    const frame = (feed: string, price: string) =>
      JSON.stringify({ feed, marketId: MARKET, data: { price } });

    m = receive(m, frame("last-traded-price", "4"));
    m = receive(m, frame("mark-price", "212.5"));

    expect(m.state.lastPrice).toBe(4);
    expect(m.state.markPrice).toBe(212.5);
    // The index is not a trade, so it must not move the tick colour either.
    expect(m.state.prevPrice).toBeNull();
  });

  it("keeps the last index it was told when the feed drops", () => {
    // Same rule as the ladder: what is on screen is the last thing the server
    // said, and the status dot is what says how old that is. Blanking it would
    // trade a stale truth for no information.
    let m = onSnapshot(onOpen(initialMachine()), depth(1));
    m = receive(
      m,
      JSON.stringify({ feed: "mark-price", marketId: MARKET, data: { price: "212.5" } }),
    );
    m = onDisconnect(m, true);

    expect(m.state.markPrice).toBe(212.5);
    expect(m.state.source).toBe("reconnecting");
  });

  it("records the arrival time of every frame, including discarded ones", () => {
    // Liveness is about traffic, not about whether a frame changed anything —
    // §7.5 treats five seconds of silence as a fault, and a stale frame is not
    // silence.
    let m = onSnapshot(onOpen(initialMachine()), depth(20));
    m = receive(m, depthFrame(5), 1_700);
    expect(m.state.lastFrameAt).toBe(1_700);
    expect(m.state.depth?.lastUpdateId).toBe(20);
  });
});

describe("backoffDelay", () => {
  const half = () => 0.5;

  it("grows with the attempt count", () => {
    const delays = [0, 1, 2, 3].map((n) => backoffDelay(n, half));
    expect(delays).toEqual([188, 375, 750, 1500]);
  });

  it("caps at 8 seconds", () => {
    for (const attempt of [6, 10, 40, 1000]) {
      expect(backoffDelay(attempt, () => 0.999)).toBeLessThanOrEqual(BACKOFF_CAP_MS);
      expect(backoffDelay(attempt, half)).toBe(BACKOFF_CAP_MS * 0.75);
    }
  });

  it("jitters within [base/2, base)", () => {
    // Every tab watching a market drops together when ws-server restarts; an
    // unjittered schedule reconnects all of them in lockstep, repeatedly.
    expect(backoffDelay(3, () => 0)).toBe(1000);
    expect(backoffDelay(3, () => 0.9999)).toBe(2000);
  });

  it("never returns a negative delay for a negative attempt", () => {
    expect(backoffDelay(-1, half)).toBe(188);
  });
});
