import { describe, expect, it } from "bun:test";
import {
  derivePosition,
  markFor,
  midPrice,
  positionLeverage,
  roe,
  totalUnrealisedPnl,
  unrealisedPnl,
} from "./position-math";
import type { Position } from "./api/schemas";

/**
 * The arithmetic behind every derived column in the Positions table.
 *
 * This is the part of Phase 9 that can be wrong without anything failing: a
 * sign error in `unrealisedPnl` renders a losing position as a winning one, in
 * green, with a plus in front of it, and nothing else on screen contradicts it.
 * So the sign is asserted on both sides, in both directions, explicitly.
 */

const position = (over: Partial<Position> = {}): Position => ({
  marketId: "m-1",
  type: "LONG",
  qty: "10",
  margin: "100",
  averagePrice: "100",
  liquidationPrice: "90",
  ...over,
});

describe("midPrice", () => {
  it("is the mid of the best bid and the best ask", () => {
    expect(midPrice({ bids: [["99", "5"]], asks: [["101", "5"]] })).toBe("100");
  });

  it("reads the TOP of each side, not the deepest level", () => {
    // The engine walks outwards from the touch, so index 0 is the best price on
    // both sides. Reading the last level would mark to the far end of the book.
    expect(
      midPrice({
        bids: [
          ["99", "5"],
          ["98", "5"],
        ],
        asks: [
          ["101", "5"],
          ["102", "5"],
        ],
      }),
    ).toBe("100");
  });

  it("is null for a one-sided book, not the side that exists", () => {
    // The normal state of this exchange early in a session. Marking to the only
    // side present would mark every position to a price nothing can trade at.
    expect(midPrice({ bids: [["99", "5"]], asks: [] })).toBeNull();
    expect(midPrice({ bids: [], asks: [["101", "5"]] })).toBeNull();
  });

  it("is null for an empty book", () => {
    expect(midPrice({ bids: [], asks: [] })).toBeNull();
  });
});

describe("unrealisedPnl", () => {
  it("is positive for a LONG marked above entry", () => {
    // The plan's worked example: LONG 10 @ 100, mark 110 → +100.
    expect(unrealisedPnl(position(), "110")).toBe(100);
  });

  it("is negative for a LONG marked below entry", () => {
    expect(unrealisedPnl(position(), "90")).toBe(-100);
  });

  it("is negative for a SHORT marked above entry", () => {
    // Same numbers, opposite side, opposite sign — this is the pair that a
    // dropped minus sign gets wrong in the direction that costs money.
    expect(unrealisedPnl(position({ type: "SHORT" }), "110")).toBe(-100);
  });

  it("is positive for a SHORT marked below entry", () => {
    expect(unrealisedPnl(position({ type: "SHORT" }), "90")).toBe(100);
  });

  it("is null when the mark is unknown, never zero", () => {
    // Zero reads as "break-even", which is a claim. Null renders an em dash.
    expect(unrealisedPnl(position(), null)).toBeNull();
  });

  it("is null when a money field is not a number", () => {
    expect(unrealisedPnl(position({ averagePrice: "" }), "110")).toBeNull();
    expect(unrealisedPnl(position({ qty: "abc" }), "110")).toBeNull();
  });
});

describe("roe", () => {
  it("is PnL as a percentage of the margin locked", () => {
    // +100 on 250 of margin is +40%.
    expect(roe(100, "250")).toBe(40);
  });

  it("keeps the sign of the PnL", () => {
    expect(roe(-100, "250")).toBe(-40);
  });

  it("is null on zero margin rather than Infinity", () => {
    // Reachable: a risk-reducing order locks no margin, and a netted-down
    // position can be left carrying very little.
    expect(roe(100, "0")).toBeNull();
  });

  it("is null when the PnL is null", () => {
    expect(roe(null, "250")).toBeNull();
  });
});

describe("positionLeverage", () => {
  it("is notional over margin, at the ENTRY price", () => {
    // The same expression the engine's cap check uses, so the badge shows the
    // number `placeOrder` would compare against `maxLeverage`.
    expect(
      positionLeverage({ qty: "10", averagePrice: "100", margin: "200" }),
    ).toBe(5);
  });

  it("is null on zero margin", () => {
    expect(
      positionLeverage({ qty: "10", averagePrice: "100", margin: "0" }),
    ).toBeNull();
  });
});

describe("derivePosition", () => {
  it("fills every derived column from one mark", () => {
    expect(derivePosition(position({ margin: "250" }), "110")).toEqual({
      mark: "110",
      unrealisedPnl: 100,
      roe: 40,
      leverage: 4,
    });
  });

  it("leaves the price-derived columns null without a mark, and keeps leverage", () => {
    // Leverage does not need a mark — it is entry-priced — so an unmarkable
    // book must not blank a column that is still knowable.
    expect(derivePosition(position({ margin: "250" }), null)).toEqual({
      mark: null,
      unrealisedPnl: null,
      roe: null,
      leverage: 4,
    });
  });
});

describe("totalUnrealisedPnl", () => {
  it("sums the rows", () => {
    expect(
      totalUnrealisedPnl([{ unrealisedPnl: 100 }, { unrealisedPnl: -30 }]),
    ).toBe(70);
  });

  it("is exactly zero for an account with no positions", () => {
    // The one total that IS knowable without a mark.
    expect(totalUnrealisedPnl([])).toBe(0);
  });

  it("is null if any single row could not be marked", () => {
    // A sum that silently skipped the unmarkable rows would be a smaller number
    // presented as a total, with nothing in the header saying which are missing.
    expect(
      totalUnrealisedPnl([{ unrealisedPnl: 100 }, { unrealisedPnl: null }]),
    ).toBeNull();
  });
});

describe("markFor", () => {
  const rest = new Map([
    ["sol", "100"],
    ["btc", "60000"],
    ["eth", null],
  ]);

  it("prefers the live book for the market on screen", () => {
    expect(markFor("sol", rest, { marketId: "sol", mid: "101" })).toBe("101");
  });

  it("leaves the other markets on their REST snapshot", () => {
    expect(markFor("btc", rest, { marketId: "sol", mid: "101" })).toBe("60000");
  });

  it("returns null when the live book has no mid, rather than the older one", () => {
    // The live book is the same book read more recently. A one-sided book now
    // means no mark now, and the snapshot's mid is a price nothing can trade at.
    expect(markFor("sol", rest, { marketId: "sol", mid: null })).toBeNull();
  });

  it("falls back cleanly when there is no feed at all", () => {
    // The header and account menu render on pages with no terminal around them.
    expect(markFor("sol", rest, { marketId: null, mid: null })).toBe("100");
    expect(markFor("eth", rest, { marketId: null, mid: null })).toBeNull();
    expect(markFor("unknown", rest, { marketId: null, mid: null })).toBeNull();
  });
});
