import { describe, expect, it } from "bun:test";
import { CreateOrderSchema } from "@repo/shared";
import { ApiError } from "@/lib/api/errors";
import {
  buildClosePayload,
  buildOrderPayload,
  CLOSE_SLIPPAGE_PERCENT,
  followedBy,
  outcomeFromResult,
  rejectionMessage,
  roundMarginUp,
  toWholePercent,
  type TicketDraft,
} from "./order-payload";
import type { CreateOrderResult } from "@/lib/api/schemas";

/**
 * The ticket→wire translation.
 *
 * Every payload here is parsed against `CreateOrderSchema` imported from
 * `@repo/shared` — the same object the backend validates the request with, not
 * a copy of it. That is the assertion that matters: a discriminated union whose
 * arms disagree about `price` and `slippage` cannot be checked by eye.
 */

const draft: TicketDraft = {
  marketSlug: "SOL-USD",
  side: "LONG",
  orderType: "limit",
  price: "204.96",
  slippage: "1",
  qty: "4.74",
  margin: 194.3,
};

describe("buildOrderPayload", () => {
  it("emits slippage 0 for a limit order and keeps the price", () => {
    const payload = buildOrderPayload(draft);
    expect(payload).toMatchObject({
      orderType: "limit",
      market: "SOL-USD",
      type: "LONG",
      price: 204.96,
      slippage: 0,
      qty: 4.74,
    });
  });

  it("emits price 0 for a market order and keeps the slippage", () => {
    const payload = buildOrderPayload({
      ...draft,
      orderType: "market",
      slippage: "2",
    });
    expect(payload).toMatchObject({
      orderType: "market",
      price: 0,
      slippage: 2,
    });
  });

  it("never lets a fractional slippage reach the wire", () => {
    // The input refuses the decimal point, so this is the second line of
    // defence — but `slippage` is an integer column and a value of 0.5 would be
    // rounded by Postgres, silently, after the confirm dialog said "0.5%".
    for (const typed of ["0.5", "1.4", "2.6", "0", "", "abc"]) {
      const { slippage } = buildOrderPayload({
        ...draft,
        orderType: "market",
        slippage: typed,
      }) as { slippage: number };
      expect(Number.isInteger(slippage)).toBe(true);
      expect(slippage).toBeGreaterThan(0);
    }
  });

  it("always sends a positive equity", () => {
    // The engine rejects an order with no margin unless it can prove the order
    // is risk-reducing, which it decides for itself. Omitting it on a guess
    // fails with "Margin required as there is no open position".
    const payload = buildOrderPayload(draft);
    expect(payload.equity).toBeGreaterThan(0);
  });

  it("rounds margin UP, so the engine's derived leverage cannot exceed the cap", () => {
    // leverage = price * qty / initialMargin. Rounding the margin down raises
    // that quotient; at exactly the cap it would tip over into rejection.
    const margin = 1000 / 3; // 333.3333333333333…
    expect(roundMarginUp(margin)).toBe(333.33333334);
    expect(roundMarginUp(margin)).toBeGreaterThan(margin);
  });

  it("produces payloads the SERVER's schema accepts", () => {
    for (const candidate of [
      draft,
      { ...draft, side: "SHORT" as const },
      { ...draft, orderType: "market" as const, price: "", slippage: "3" },
      { ...draft, qty: "0.001", margin: 0.04 },
    ]) {
      const parsed = CreateOrderSchema.safeParse(buildOrderPayload(candidate));
      expect(parsed.success).toBe(true);
    }
  });

  it("fails the server's schema rather than sending a zero-margin order", () => {
    // Better here than as a 400: the ticket blocks this with `canSubmit`, and
    // if that guard ever regresses the payload must not be silently valid.
    const parsed = CreateOrderSchema.safeParse(
      buildOrderPayload({ ...draft, margin: 0 }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe("toWholePercent", () => {
  it("floors at 1 — the schema rejects a slippage of 0", () => {
    expect(toWholePercent("0")).toBe(1);
    expect(toWholePercent("0.2")).toBe(1);
    expect(toWholePercent("")).toBe(1);
  });
});

const result = (over: Partial<CreateOrderResult>): CreateOrderResult => ({
  orderId: "3f4b1e2c-0000-4000-8000-000000000001",
  status: "filled",
  filledQty: "4.74",
  totalPrice: "971.51",
  averagePrice: "204.96",
  fills: [],
  ...over,
});

describe("outcomeFromResult", () => {
  it("calls a fully matched order filled and prices it at the executed average", () => {
    expect(outcomeFromResult(result({}), draft)).toEqual({
      status: "filled",
      qty: "4.74",
      price: "204.96",
    });
  });

  it("calls a short fill partial and reports the quantity that actually filled", () => {
    expect(
      outcomeFromResult(
        result({ status: "partially_filled", filledQty: "1.2" }),
        draft,
      ),
    ).toEqual({ status: "partial", qty: "1.2", price: "204.96" });
  });

  it("calls an untouched limit order resting, at its own limit price", () => {
    expect(
      outcomeFromResult(
        result({ status: "open", filledQty: "0", averagePrice: "0" }),
        draft,
      ),
    ).toEqual({ status: "resting", qty: "4.74", price: "204.96" });
  });

  it("shows NO price for a market order that matched nothing", () => {
    // G29's other half: the engine writes the slippage percent into
    // `orders.price` for a market order, and `averagePrice` is 0 when nothing
    // filled. Both are numbers; neither is a price. So: no price.
    const outcome = outcomeFromResult(
      result({ status: "cancelled", filledQty: "0", averagePrice: "0" }),
      { ...draft, orderType: "market" },
    );
    expect(outcome).toEqual({ status: "cancelled", qty: "4.74" });
    expect(outcome.price).toBeUndefined();
  });

  it("never reports the submitted price for a market order that DID fill", () => {
    const outcome = outcomeFromResult(
      result({ filledQty: "4.74", averagePrice: "205.40" }),
      { ...draft, orderType: "market", price: "1" },
    );
    expect(outcome.price).toBe("205.40");
  });
});

describe("rejectionMessage", () => {
  it("passes the engine's own words through", () => {
    const err = new ApiError({
      status: 400,
      code: "INVALID_REQUEST",
      message: "User does not have available margin",
    });
    expect(rejectionMessage(err)).toBe("User does not have available margin");
  });

  it("prefers a named field error when there is one", () => {
    const err = new ApiError({
      status: 0,
      code: "VALIDATION_FAILED",
      message: "Invalid order",
      fieldErrors: { qty: "Too small: expected number to be >0" },
    });
    expect(rejectionMessage(err)).toBe("Too small: expected number to be >0");
  });

  it("invents nothing for an error it cannot read", () => {
    expect(rejectionMessage(new Error("socket hang up"))).toBe(
      "The order could not be placed.",
    );
  });
});

describe("buildClosePayload", () => {
  const long = {
    market: { slug: "SOL-USD" },
    type: "LONG" as const,
    qty: "12.5",
  };

  it("omits equity entirely — the key must not be present", () => {
    const payload = buildClosePayload(long);
    /**
     * This is G13 and the whole phase turns on it. Omitting `equity` is what
     * makes the engine treat the order as risk-reducing: it zeroes the margin,
     * skips the collateral debit and skips the leverage cap. Sending the
     * position's own margin instead demands free collateral in order to get
     * flat, which is exactly backwards.
     *
     * `in` rather than a comparison against undefined: an explicit
     * `equity: undefined` would serialise away over JSON but is a different
     * object, and the distinction is easy to lose in a refactor.
     */
    expect("equity" in payload).toBe(false);
  });

  it("takes the OPPOSITE side of the position", () => {
    // One-way netting: an opposite-side order for the full size nets to zero.
    // A same-side one doubles the position — the worst possible outcome for a
    // button labelled "Close".
    expect(buildClosePayload(long).type).toBe("SHORT");
    expect(buildClosePayload({ ...long, type: "SHORT" }).type).toBe("LONG");
  });

  it("closes the FULL size", () => {
    expect(buildClosePayload(long).qty).toBe(12.5);
  });

  it("is the market arm of the contract: price 0, positive integer slippage", () => {
    const payload = buildClosePayload(long);
    expect(payload.orderType).toBe("market");
    expect(payload.price).toBe(0);
    expect(payload.slippage).toBe(CLOSE_SLIPPAGE_PERCENT);
    expect(Number.isInteger(payload.slippage)).toBe(true);
    expect(payload.slippage).toBeGreaterThan(0);
  });

  it("parses against CreateOrderSchema, on both sides", () => {
    // The union has no useful error for a payload that is nearly right, so the
    // real assertion is that the server's own schema accepts it.
    for (const type of ["LONG", "SHORT"] as const) {
      const parsed = CreateOrderSchema.safeParse(
        buildClosePayload({ ...long, type }),
      );
      expect(parsed.success).toBe(true);
      // `.optional()` means a missing equity survives the parse as missing.
      expect(parsed.success && parsed.data.equity).toBeUndefined();
    }
  });

  it("carries the market SLUG, which is what POST /order keys on", () => {
    // The rest of the app passes market UUIDs around; this one field is the
    // slug, because `CreateOrderSchema.market` is looked up by `markets.slug`.
    expect(buildClosePayload(long).market).toBe("SOL-USD");
  });
});

describe("followedBy", () => {
  /**
   * The bug this exists for, in the words the browser showed in Phase 15: the
   * backend's ENGINE_TIMEOUT message ends without a full stop, so the ticket
   * read "The matching engine is not responding Check Open orders before
   * placing it again."
   */
  it("punctuates a server message that did not punctuate itself", () => {
    expect(
      followedBy(
        "The matching engine is not responding",
        "Check Open orders before placing it again.",
      ),
    ).toBe(
      "The matching engine is not responding. Check Open orders before placing it again.",
    );
  });

  it("leaves a message that ended in a sentence alone", () => {
    expect(followedBy("The request timed out.", "Try again.")).toBe(
      "The request timed out. Try again.",
    );
    expect(followedBy("Are you sure?", "Try again.")).toBe(
      "Are you sure? Try again.",
    );
  });

  it("shows only our own sentence when the server sent no words", () => {
    expect(followedBy("   ", "Try again.")).toBe("Try again.");
  });
});
