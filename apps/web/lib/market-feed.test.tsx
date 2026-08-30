import { beforeEach, describe, expect, it } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MARKETS } from "./markets";
import { MarketFeedProvider, useMarketFeed } from "./market-feed";

/**
 * The transport, driven by a fake socket.
 *
 * `market-feed-core.test.ts` owns the reconciliation rules; this file owns the
 * things only the provider can get wrong — that exactly one socket is open at a
 * time, that the snapshot is fetched on every open, that a drop schedules a
 * retry and a clean open resets the backoff, and that unmounting takes the
 * socket with it. All four were previously invisible: the old hook papered over
 * a dead socket with a simulator, so "the feed is broken" and "the feed is
 * working" rendered the same.
 *
 * `fetch` is stubbed rather than the endpoints module mocked — `mock.module` in
 * Bun is process-global and two suites disagreeing about one module makes the
 * run order-dependent.
 */

const SOL = MARKETS.find((m) => m.slug === "SOL-USD")!;
const BTC = MARKETS.find((m) => m.slug === "BTC-USD")!;

type Depth = {
  market: string;
  lastUpdateId: number;
  timestamp: number;
  bids: [string, string][];
  asks: [string, string][];
};

const depth = (market: string, lastUpdateId: number, bid: string): Depth => ({
  market,
  lastUpdateId,
  timestamp: 1_756_000_000_000,
  bids: [[bid, "5"]],
  asks: [["999", "5"]],
});

/** A fake WebSocket that records itself and can be driven from a test. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static get open() {
    return FakeSocket.instances.filter((s) => !s.closed);
  }

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  /** The server accepted the upgrade. */
  accept() {
    this.onopen?.();
  }

  send(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** The server went away. Mirrors the browser: onclose fires after onerror. */
  drop() {
    this.closed = true;
    this.onerror?.();
    this.onclose?.();
  }
}

let snapshots: Depth[] = [];
let depthRequests = 0;
let depthFails = false;

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const match = url.match(/\/depth\?marketId=(.+)$/);
  if (match) {
    depthRequests++;
    if (depthFails) {
      return new Response(JSON.stringify({ message: "down" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
    const marketId = decodeURIComponent(match[1]!);
    const body =
      snapshots.find((s) => s.market === marketId) ?? depth(marketId, 1, "100");
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`unexpected fetch: ${url}`);
}) as typeof fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.WebSocket = FakeSocket as any;

beforeEach(() => {
  FakeSocket.instances = [];
  snapshots = [];
  depthRequests = 0;
  depthFails = false;
});

/**
 * Neither the socket nor `fetch` is restored, and that is the convention here
 * rather than an oversight: a trailing `globalThis.fetch = realFetch` runs at
 * module evaluation — before any test — and every test in the file then hits
 * the real network. The other terminal suites each install their own stub for
 * the same reason. No other suite opens a socket, so the fake constructor left
 * behind is inert.
 */
void realFetch;

function Probe() {
  const feed = useMarketFeed();
  return (
    <div>
      <span data-testid="source">{feed.source}</span>
      <span data-testid="stale">{String(feed.stale)}</span>
      <span data-testid="bid">{feed.depth?.bids[0]?.[0] ?? "none"}</span>
      <span data-testid="update-id">{String(feed.depth?.lastUpdateId ?? "none")}</span>
      <span data-testid="last">{String(feed.lastPrice ?? "none")}</span>
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

/**
 * Socket events are the "user interaction" of this suite, so they go through
 * `act` — an async one, because accepting a connection also kicks off the
 * snapshot fetch and the state update lands a microtask later.
 */
const drive = (fn: () => void) => act(async () => { fn(); });

const renderFeed = (market = SOL, staleAfterMs?: number) =>
  render(
    <MarketFeedProvider market={market} staleAfterMs={staleAfterMs}>
      <Probe />
    </MarketFeedProvider>,
  );

describe("MarketFeedProvider", () => {
  it("subscribes to the engine's market UUID, not the slug", async () => {
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));

    // G2: a slug here subscribes to `feed:SOL-USD:depth`, a topic nothing ever
    // publishes to — and the failure is silence, not an error.
    const url = FakeSocket.instances[0]!.url;
    expect(url).toContain(`market_id=${SOL.id}`);
    expect(url).toContain("feeds=last-traded-price,mark-price,depth,trades");
  });

  it("fetches the REST snapshot on open and goes live with it", async () => {
    snapshots = [depth(SOL.id, 10, "110")];
    renderFeed();

    expect(text("source")).toBe("connecting");
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());

    await waitFor(() => expect(text("source")).toBe("live"));
    expect(text("bid")).toBe("110");
    expect(depthRequests).toBe(1);
  });

  it("buffers socket frames until the snapshot resolves", async () => {
    snapshots = [depth(SOL.id, 10, "110")];
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));

    const socket = FakeSocket.instances[0]!;
    await act(async () => {
      socket.accept();
      // Same tick as the accept, so this lands while the fetch is in flight.
      socket.send({
        feed: "depth",
        marketId: SOL.id,
        data: depth(SOL.id, 12, "112"),
      });
    });

    await waitFor(() => expect(text("source")).toBe("live"));
    // The buffered frame is newer than the snapshot, so it survives the drain.
    expect(text("update-id")).toBe("12");
    expect(text("bid")).toBe("112");
  });

  it("ignores a malformed frame without tearing the connection down", async () => {
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0]!;
    await drive(() => socket.accept());
    await waitFor(() => expect(text("source")).toBe("live"));

    await act(async () => {
      socket.onmessage?.({ data: "{not json" });
      socket.send({ feed: "depth", marketId: SOL.id, data: { nonsense: true } });
      socket.send({ feed: "last-traded-price", marketId: SOL.id, data: { price: "42" } });
    });

    await waitFor(() => expect(text("last")).toBe("42"));
    expect(text("source")).toBe("live");
    expect(FakeSocket.open).toHaveLength(1);
  });

  it("reconnects after a drop and resynchronises from REST", async () => {
    snapshots = [depth(SOL.id, 10, "110")];
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());
    await waitFor(() => expect(text("source")).toBe("live"));

    await drive(() => FakeSocket.instances[0]!.drop());
    await waitFor(() => expect(text("source")).toBe("reconnecting"));
    // The last book the server sent stays on screen, frozen and marked.
    expect(text("bid")).toBe("110");

    // First retry is drawn from [125ms, 250ms) — waitFor outlives that.
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    snapshots = [depth(SOL.id, 40, "140")];
    await drive(() => FakeSocket.instances[1]!.accept());

    await waitFor(() => expect(text("bid")).toBe("140"));
    expect(text("source")).toBe("live");
    expect(depthRequests).toBe(2);
    expect(FakeSocket.open).toHaveLength(1);
  });

  it("treats a failed snapshot as a connection fault and retries", async () => {
    depthFails = true;
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());

    // Without a baseline every frame is still buffered, so a healthy socket
    // with no snapshot is not a usable feed.
    await waitFor(() => expect(text("source")).toBe("reconnecting"));
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    expect(FakeSocket.open).toHaveLength(1);
  });

  it("falls back to a REST book when the socket never opens", async () => {
    // ws-server down, backend up — the common half-broken stack. Before this
    // the ladder shimmered forever, which claims data is on its way.
    snapshots = [depth(SOL.id, 10, "110")];
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.drop());

    await waitFor(() => expect(text("bid")).toBe("110"));
    // A real book, labelled as not live. Both halves matter.
    expect(text("source")).toBe("reconnecting");
  });

  it("resets the backoff on a clean open, so a second drop retries quickly", async () => {
    renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());
    await waitFor(() => expect(text("source")).toBe("live"));

    const before = Date.now();
    await drive(() => FakeSocket.instances[0]!.drop());
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    await drive(() => FakeSocket.instances[1]!.accept());
    await waitFor(() => expect(text("source")).toBe("live"));

    await drive(() => FakeSocket.instances[1]!.drop());
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(3));
    // Two drops at attempt 0 each: both retries are under 250ms, where an
    // un-reset schedule would have made the second one ~500ms and climbing.
    expect(Date.now() - before).toBeLessThan(1_000);
  });

  it("marks a silent connection stale, and un-marks it when a frame arrives", async () => {
    // The price poller drives a depth broadcast at ~1 Hz per market, so silence
    // is a fault rather than a quiet market (§7.5). Five real seconds compressed
    // into fifty milliseconds; the rule is the same one.
    renderFeed(SOL, 50);
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0]!;
    await drive(() => socket.accept());
    await waitFor(() => expect(text("source")).toBe("live"));

    await drive(() =>
      socket.send({ feed: "last-traded-price", marketId: SOL.id, data: { price: "10" } }),
    );
    expect(text("stale")).toBe("false");

    await waitFor(() => expect(text("stale")).toBe("true"));
    // Still `live`: the socket has not dropped, it has gone quiet, and those are
    // different claims about the numbers on screen.
    expect(text("source")).toBe("live");

    await drive(() =>
      socket.send({ feed: "last-traded-price", marketId: SOL.id, data: { price: "11" } }),
    );
    expect(text("stale")).toBe("false");
  });

  it("opens exactly one socket across a market switch", async () => {
    snapshots = [depth(SOL.id, 10, "110"), depth(BTC.id, 20, "220")];
    const view = renderFeed(SOL);
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());
    await waitFor(() => expect(text("bid")).toBe("110"));

    view.rerender(
      <MarketFeedProvider market={BTC}>
        <Probe />
      </MarketFeedProvider>,
    );

    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    expect(FakeSocket.instances[0]!.closed).toBe(true);
    expect(FakeSocket.instances[1]!.url).toContain(`market_id=${BTC.id}`);
    // The old market's book does not survive into the new market's ladder.
    expect(text("bid")).toBe("none");

    await drive(() => FakeSocket.instances[1]!.accept());
    await waitFor(() => expect(text("bid")).toBe("220"));
    expect(FakeSocket.open).toHaveLength(1);
  });

  it("closes the socket on unmount and stops reconnecting", async () => {
    const view = renderFeed();
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await drive(() => FakeSocket.instances[0]!.accept());
    await waitFor(() => expect(text("source")).toBe("live"));

    view.unmount();
    expect(FakeSocket.instances[0]!.closed).toBe(true);

    // A socket abandoned by a teardown must not schedule a retry: its handlers
    // are dropped before close(), because close() fires onclose.
    await drive(() => FakeSocket.instances[0]!.drop());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
