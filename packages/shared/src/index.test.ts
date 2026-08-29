import { describe, expect, it } from "bun:test";
import { CreateOrderSchema } from "./index";

/**
 * The order contract, both sides of the wire.
 *
 * `apps/backend` validates with this exact object and the order ticket will
 * build against it in Phase 7, so these cases document what the discriminated
 * union actually permits — including the two constraints that are easy to get
 * wrong from the UI side.
 */
const limit = {
  orderType: "limit",
  price: 95,
  slippage: 0,
  qty: 1,
  equity: 95,
  type: "LONG",
  market: "SOL-USD",
};

const market = {
  orderType: "market",
  price: 0,
  slippage: 1,
  qty: 1,
  equity: 95,
  type: "SHORT",
  market: "SOL-USD",
};

describe("CreateOrderSchema", () => {
  it("accepts a well-formed limit order", () => {
    expect(CreateOrderSchema.safeParse(limit).success).toBe(true);
  });

  it("accepts a well-formed market order", () => {
    expect(CreateOrderSchema.safeParse(market).success).toBe(true);
  });

  it("requires slippage to be exactly 0 on a limit order", () => {
    expect(CreateOrderSchema.safeParse({ ...limit, slippage: 1 }).success).toBe(
      false,
    );
  });

  it("requires price to be exactly 0 on a market order", () => {
    expect(CreateOrderSchema.safeParse({ ...market, price: 95 }).success).toBe(
      false,
    );
  });

  it("requires a positive slippage on a market order", () => {
    expect(
      CreateOrderSchema.safeParse({ ...market, slippage: 0 }).success,
    ).toBe(false);
  });

  it("treats equity as optional — the engine, not the schema, requires it", () => {
    // This is what makes a close-position order legal: no margin, because the
    // engine recognises it as risk-reducing. See Phase 9.
    const { equity, ...withoutEquity } = market;
    expect(CreateOrderSchema.safeParse(withoutEquity).success).toBe(true);
  });

  it("takes a market SLUG, not a market id", () => {
    // Every other route takes the UUID; this one is resolved against
    // markets.slug by order-service. The asymmetry is real and load-bearing.
    const parsed = CreateOrderSchema.parse(limit);
    expect(parsed.market).toBe("SOL-USD");
  });
});
