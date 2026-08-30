import { describe, expect, it } from "bun:test";
import type { FillView, OrderRecord } from "@/lib/api/schemas";
import {
  averageFillPrice,
  fillsByOrder,
  historyPrice,
  isHistoricalOrder,
} from "./order-history";

/**
 * The market-order price trap, and the terminal-status filter.
 *
 * Pure, like `position-math.ts`, and for the same reason: the numbers are small
 * and what happens when they are wrong is not. A "0.00" in a price cell is a
 * price the order never traded at.
 */

const fill = (price: string, qty: string, orderId = "o1"): FillView => ({
  id: `f-${price}-${qty}`,
  marketId: "m1",
  marketSlug: "SOL-USD",
  side: "LONG",
  role: "taker",
  orderId,
  qty,
  price,
  createdAt: "2026-08-30T10:00:00.000Z",
});

const order = (over: Partial<OrderRecord> = {}): OrderRecord => ({
  id: "o1",
  userId: "u1",
  marketId: "m1",
  positionType: "LONG",
  orderType: "limit",
  status: "filled",
  qty: "10",
  filledQty: "10",
  price: "95",
  slippage: 0,
  initialMargin: "950",
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:01.000Z",
  ...over,
});

describe("averageFillPrice", () => {
  it("weights by size, not by fill count", () => {
    // 9 at 95 and 1 at 99 executed at 95.4. The unweighted mean is 97 — a
    // price this order never traded at, and the reason this is a function.
    expect(averageFillPrice([fill("95", "9"), fill("99", "1")])).toBe("95.4");
  });

  it("returns the price itself for a single fill", () => {
    expect(averageFillPrice([fill("95.5", "3")])).toBe("95.5");
  });

  it("is null with no fills, not zero", () => {
    // An order that never executed has no execution price.
    expect(averageFillPrice([])).toBeNull();
  });

  it("is null when the fills carry no size", () => {
    // 0/0 is NaN, which formats as an em dash by luck rather than by decision.
    expect(averageFillPrice([fill("95", "0")])).toBeNull();
  });

  it("is null rather than smaller when one fill is unparseable", () => {
    expect(averageFillPrice([fill("95", "1"), fill("oops", "1")])).toBeNull();
  });
});

describe("historyPrice", () => {
  it("prints a limit order's own limit price", () => {
    expect(historyPrice(order({ orderType: "limit", price: "95" }), [])).toBe(
      "95",
    );
  });

  it("prints a market order's executed average, never its price column", () => {
    // G29: `orders.price` is the 0 the client sent, and nothing writes the
    // executed price back. This is the assertion that catches a regression to it.
    const market = order({ orderType: "market", price: "0" });
    expect(historyPrice(market, [fill("95", "9"), fill("99", "1")])).toBe(
      "95.4",
    );
  });

  it("gives a market order with no fills an em dash, not 0.00", () => {
    const cancelled = order({
      orderType: "market",
      price: "0",
      status: "cancelled",
      filledQty: "0",
    });
    expect(historyPrice(cancelled, [])).toBeNull();
  });
});

describe("fillsByOrder", () => {
  it("buckets fills under the account's own order id", () => {
    const byOrder = fillsByOrder([
      fill("95", "1", "o1"),
      fill("96", "2", "o2"),
      fill("97", "3", "o1"),
    ]);
    expect(byOrder.get("o1")).toHaveLength(2);
    expect(byOrder.get("o2")).toHaveLength(1);
    expect(byOrder.get("o3")).toBeUndefined();
  });
});

describe("isHistoricalOrder", () => {
  it("accepts the terminal statuses", () => {
    expect(isHistoricalOrder({ status: "filled" })).toBe(true);
    expect(isHistoricalOrder({ status: "cancelled" })).toBe(true);
  });

  it("rejects everything the Open-orders tab already shows", () => {
    // A row in both tables, one with a Cancel button and one without, reads as
    // two orders.
    expect(isHistoricalOrder({ status: "open" })).toBe(false);
    expect(isHistoricalOrder({ status: "partially_filled" })).toBe(false);
  });

  it("rejects pending, which is neither resting nor finished", () => {
    expect(isHistoricalOrder({ status: "pending" })).toBe(false);
  });
});
