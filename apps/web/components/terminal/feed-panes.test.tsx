import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { OrderBook } from "./order-book";
import { TradesFeed } from "./trades-feed";
import { MARKETS } from "@/lib/markets";
import type { Depth, FeedState } from "@/lib/market-feed";

/**
 * The two public panes, and the state each of them used to get wrong.
 *
 * Both are pure: they take the feed's state as props and own no requests, so
 * these render directly with no providers. What is under test is the mapping
 * from `(data, source)` to which atom appears — the honesty question, not the
 * transport.
 *
 * The bug in both cases was the same shape. "No data yet" and "no data coming"
 * are different facts, and each pane collapsed them into whichever of its
 * states happened to be the fallback: the ladder shimmered forever, and the
 * tape said the market was quiet.
 */

const SOL = MARKETS.find((m) => m.slug === "SOL-USD")!;

const book: Depth = {
  market: SOL.id,
  timestamp: 0,
  bids: [["100.00", "5"]],
  asks: [["100.50", "4"]],
  lastUpdateId: 1,
};

const empty: Depth = {
  market: SOL.id,
  timestamp: 0,
  bids: [],
  asks: [],
  lastUpdateId: 2,
};

function ladder(depth: Depth | null, source: FeedState["source"]) {
  return render(
    <OrderBook
      depth={depth}
      lastPrice={null}
      prevPrice={null}
      change={null}
      source={source}
      market={SOL}
      onPriceSelect={() => undefined}
    />,
  );
}

describe("the ladder", () => {
  it("shimmers while the first snapshot is genuinely on its way", () => {
    ladder(null, "connecting");
    expect(
      screen.getByText(/loading sol-usd order book/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops shimmering once the feed has given up", () => {
    /**
     * The Phase 14 addition. `MarketFeedProvider` falls back to one REST read
     * when the socket fails with no book on screen; when that fails too there
     * is nothing coming but a backoff timer, and a skeleton that shimmers
     * indefinitely is a promise nothing is keeping.
     */
    ladder(null, "reconnecting");
    expect(screen.getByRole("alert")).toHaveTextContent(/no order book/i);
    expect(
      screen.queryByText(/loading sol-usd order book/i),
    ).not.toBeInTheDocument();
  });

  it("says the book is EMPTY only when the server said so", () => {
    ladder(empty, "live");
    expect(screen.getByText(/no resting orders/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps showing the last book it was given while reconnecting", () => {
    // The ladder is not wrong here and must not be blanked: it is the last
    // thing the server said, and the market bar's status dot is what says it
    // is no longer moving.
    ladder(book, "reconnecting");
    expect(screen.getByText("100.00")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("draws the levels when it has them", () => {
    ladder(book, "live");
    expect(screen.getByText("100.00")).toBeInTheDocument();
    expect(screen.getByText("100.50")).toBeInTheDocument();
  });
});

function tape(trades: [], source: FeedState["source"]) {
  return render(
    <TradesFeed trades={trades} market={SOL} source={source} available />,
  );
}

describe("the tape", () => {
  it("shimmers while the socket is opening", () => {
    tape([], "connecting");
    expect(screen.getByText(/loading sol-usd trades/i)).toBeInTheDocument();
  });

  it("does not call the market quiet when the feed is down", () => {
    /**
     * "No prints yet" is a claim about the MARKET. Prints are pushed and never
     * backfilled, so a client that was not connected simply did not see what
     * traded — saying nothing traded would be inventing the one fact this pane
     * exists to report.
     */
    tape([], "disconnected");
    expect(screen.getByRole("alert")).toHaveTextContent(/trades unavailable/i);
    expect(screen.queryByText(/no prints yet/i)).not.toBeInTheDocument();
  });

  it("says the market is quiet when it is connected and quiet", () => {
    tape([], "live");
    expect(screen.getByText(/no prints yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the exchange publishes no tape when it does not", () => {
    // The `available` flag is a different claim again, and outranks all three:
    // before Phase 12 nothing was ever published to this feed.
    render(
      <TradesFeed
        trades={[]}
        market={SOL}
        source="live"
        available={false}
      />,
    );
    expect(screen.getByText(/no public trade tape/i)).toBeInTheDocument();
  });
});
