import { describe, expect, it } from "bun:test";
import type { TWriterSchema } from "@repo/shared/redis-events";
import { hasRowsToWrite } from "./writer";

/**
 * Regression cover for the idempotency-row flood.
 *
 * The engine emits a `writer` array on every liquidation sweep whether or not
 * anything happened, and the price poller triggers one per market per second.
 * Writing on those is what produced 4,026 `processed_events` rows against 18
 * orders and 0 fills.
 */
const empty: TWriterSchema = [
  { table: "order_inserts", data: [] },
  { table: "order_updates", data: [] },
  { table: "fills", data: [] },
];

describe("hasRowsToWrite", () => {
  it("is false for the liquidation-sweep shape the price poller produces", () => {
    expect(hasRowsToWrite(empty)).toBe(false);
  });

  it("is false for an entirely absent writer payload", () => {
    expect(hasRowsToWrite([])).toBe(false);
  });

  it("is true when any one table carries a row", () => {
    const withUpdate: TWriterSchema = [
      { table: "order_inserts", data: [] },
      {
        table: "order_updates",
        data: [
          {
            orderId: "11111111-1111-1111-1111-111111111111",
            userId: "22222222-2222-2222-2222-222222222222",
            status: "filled",
            filledQty: 5,
          },
        ],
      },
      { table: "fills", data: [] },
    ];
    expect(hasRowsToWrite(withUpdate)).toBe(true);
  });

  it("is true when only the last table carries rows", () => {
    const withFill: TWriterSchema = [
      { table: "order_inserts", data: [] },
      { table: "order_updates", data: [] },
      {
        table: "fills",
        data: [
          {
            makerId: "33333333-3333-3333-3333-333333333333",
            takerId: "44444444-4444-4444-4444-444444444444",
            marketId: "e3289213-372c-44d2-8cc8-2a6eb55b11b1",
            qty: "1",
            price: "90",
            makerOrderId: "55555555-5555-5555-5555-555555555555",
            takerOrderId: "66666666-6666-6666-6666-666666666666",
          },
        ],
      },
    ];
    expect(hasRowsToWrite(withFill)).toBe(true);
  });
});
