import { describe, expect, it } from "bun:test";
import { render as rtlRender, screen } from "@testing-library/react";
// Imported from its own module, not the `components/ui` barrel: the barrel
// duplicates React context across the server/client boundary.
import { TooltipProvider } from "@/components/ui/tooltip";
import { MarketBar } from "./market-bar";
import { TradesFeed } from "./trades-feed";
import { TRADES_PUBLISHED, type MarketFeedValue } from "@/lib/market-feed";
import { MARKETS } from "@/lib/markets";

/**
 * The two surfaces Phase 12 turned from em dashes into data — and the four it
 * deliberately left as em dashes.
 *
 * Both components are pure props, so these are direct renders with no data
 * layer and no network. The assertions are about what a number on this bar
 * *claims*: a figure with no source is a lie whether or not it is plausible,
 * and the index and the mid are two different prices that must not be
 * presented as one.
 */

const SOL = MARKETS.find((m) => m.slug === "SOL-USD")!;

/** Every stat on the bar is tooltipped, so the provider is not optional here. */
const render = (ui: React.ReactElement) =>
  rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

const feed = (over: Partial<MarketFeedValue> = {}): MarketFeedValue => ({
  depth: null,
  trades: [],
  lastPrice: null,
  prevPrice: null,
  markPrice: null,
  source: "live",
  lastFrameAt: 1,
  stale: false,
  ...over,
});

/** The value of a labelled stat, addressed through its own label. */
const stat = (label: string) =>
  screen.getByText(label).parentElement!.lastElementChild!.textContent;

describe("MarketBar", () => {
  it("shows the index price the feed carries", () => {
    render(<MarketBar market={SOL} feed={feed({ markPrice: 212.5 })} />);
    expect(stat("Index price")).toBe("212.50");
  });

  it("shows an em dash until a frame carries one", () => {
    // Null is "no frame yet", which is not a price. Before Phase 12 this was
    // permanent: the engine broadcast the seed it was created with and the
    // client refused to parse the frame at all.
    render(<MarketBar market={SOL} feed={feed()} />);
    expect(stat("Index price")).toBe("—");
  });

  it("does not call it the mark, because the Positions tab marks differently", () => {
    // The bar shows `orderbook.indexPrice` — Binance spot, what liquidations
    // are evaluated against. A position row marks against the mid of this
    // exchange's own book. Two prices, and on a book left at four dollars they
    // differ by a factor of fifty; one label over both would be the lie.
    render(<MarketBar market={SOL} feed={feed({ markPrice: 212.5 })} />);
    expect(screen.queryByText("Mark price")).toBeNull();
  });

  it("keeps the last trade and the index apart", () => {
    render(
      <MarketBar market={SOL} feed={feed({ lastPrice: 4, markPrice: 212.5 })} />,
    );
    expect(screen.getByText("4.00")).toBeDefined();
    expect(stat("Index price")).toBe("212.50");
  });

  it("still shows four em dashes for the 24h statistics", () => {
    // D6: there is no stats endpoint and no 24h aggregate over `fills`. Phase
    // 12 gave the mark a source; it did not give these one, and computing them
    // from the prints this client happens to have seen since it connected would
    // be the simulator's figure with a shorter window.
    render(<MarketBar market={SOL} feed={feed({ markPrice: 212.5 })} />);
    for (const label of ["24h change", "24h high", "24h low", "24h volume (USD)"]) {
      expect(stat(label)).toBe("—");
    }
  });
});

describe("TradesFeed", () => {
  const print = (over: Record<string, unknown> = {}) => ({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    price: "105",
    qty: "2",
    side: "buy" as const,
    ts: 1_756_000_000_000,
    ...over,
  });

  it("renders a print with its side spelled out, not only coloured", () => {
    // CLAUDE.md: colour must never be the only carrier of direction.
    render(
      <TradesFeed trades={[print()]} market={SOL} source="live" available />,
    );
    expect(screen.getByText("105.00")).toBeDefined();
    expect(screen.getByText("Buy")).toBeDefined();
  });

  it("says the market is quiet, not that there is no tape", () => {
    // These two empty states are different claims. Before Phase 12 only the
    // second could be true; now only the first can.
    render(<TradesFeed trades={[]} market={SOL} source="live" available />);
    expect(screen.getByText("No prints yet")).toBeDefined();
  });

  it("is handed a flag that now says the tape exists", () => {
    expect(TRADES_PUBLISHED).toBe(true);
  });
});
