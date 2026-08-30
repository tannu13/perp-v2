import { describe, expect, it } from "bun:test";
import {
  decodeFillCursor,
  encodeFillCursor,
  fillViewsFor,
  type JoinedFillRow,
} from "./fill-view";

/**
 * Side is per-viewer. That is the whole point of this module and it is the
 * assertion that matters: one row, two accounts, opposite answers.
 *
 * No database — these are pure functions, so unlike the query tests in
 * `order-service.test.ts` they run in every environment.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const MAKER_ORDER = "0d0d0d0d-0000-4000-8000-00000000000a";
const TAKER_ORDER = "0d0d0d0d-0000-4000-8000-00000000000b";

const fill = (over: Partial<JoinedFillRow> = {}): JoinedFillRow => ({
  id: "ffffffff-0000-4000-8000-000000000001",
  marketId: "aaaaaaaa-0000-4000-8000-00000000000a",
  makerId: ALICE,
  takerId: BOB,
  makerOrderId: MAKER_ORDER,
  takerOrderId: TAKER_ORDER,
  qty: "2",
  price: "95.5",
  createdAt: new Date("2026-08-30T10:00:00.000Z"),
  market: { slug: "SOL-USD" },
  makerOrder: { positionType: "SHORT" },
  takerOrder: { positionType: "LONG" },
  ...over,
});

describe("fillViewsFor", () => {
  it("reports the maker's own side and role", () => {
    const [view, ...rest] = fillViewsFor(fill(), ALICE);

    expect(rest).toEqual([]);
    expect(view).toMatchObject({
      side: "SHORT",
      role: "maker",
      orderId: MAKER_ORDER,
      marketSlug: "SOL-USD",
      price: "95.5",
      qty: "2",
    });
  });

  it("reports the OPPOSITE side to the counterparty on the same row", () => {
    // The assertion this module exists for. One trade, two truths.
    const [mine] = fillViewsFor(fill(), ALICE);
    const [theirs] = fillViewsFor(fill(), BOB);

    expect(mine!.side).toBe("SHORT");
    expect(mine!.role).toBe("maker");
    expect(theirs!.side).toBe("LONG");
    expect(theirs!.role).toBe("taker");
    // Same trade: same id, same price, same size.
    expect(theirs!.id).toBe(mine!.id);
    expect(theirs!.price).toBe(mine!.price);
  });

  it("does not read the side off the other party's order", () => {
    // A real row always has opposite sides, so if the maker view ever reported
    // the taker's direction, flipping the pair is what would catch it.
    const [view] = fillViewsFor(
      fill({
        makerOrder: { positionType: "LONG" },
        takerOrder: { positionType: "SHORT" },
      }),
      ALICE,
    );
    expect(view!.side).toBe("LONG");
  });

  it("returns both sides of a self-trade", () => {
    // Reachable: the engine matches on price and never checks that the two
    // orders belong to different users. Collapsing it would hide half a trade.
    const views = fillViewsFor(fill({ takerId: ALICE }), ALICE);

    expect(views).toHaveLength(2);
    expect(views.map((v) => v.role)).toEqual(["maker", "taker"]);
    expect(views.map((v) => v.side)).toEqual(["SHORT", "LONG"]);
    // `id` alone is therefore NOT a unique key in the response.
    expect(views[0]!.id).toBe(views[1]!.id);
    expect(views[0]!.orderId).not.toBe(views[1]!.orderId);
  });

  it("omits a fill the account had no part in rather than throwing", () => {
    expect(fillViewsFor(fill(), "33333333-3333-4333-8333-333333333333")).toEqual(
      [],
    );
  });

  it("emits createdAt as an ISO string", () => {
    // It sorts as text, which is what every table above this relies on.
    const [view] = fillViewsFor(fill(), ALICE);
    expect(view!.createdAt).toBe("2026-08-30T10:00:00.000Z");
  });
});

describe("the fill cursor", () => {
  it("round-trips a timestamp and an id", () => {
    const row = { createdAt: new Date("2026-08-30T10:00:00.000Z"), id: "abc" };
    const decoded = decodeFillCursor(encodeFillCursor(row));

    expect(decoded!.id).toBe("abc");
    expect(decoded!.createdAt.toISOString()).toBe(row.createdAt.toISOString());
  });

  it("carries the id, because a sweep writes fills at the same instant", () => {
    const at = new Date("2026-08-30T10:00:00.000Z");
    expect(encodeFillCursor({ createdAt: at, id: "a" })).not.toBe(
      encodeFillCursor({ createdAt: at, id: "b" }),
    );
  });

  it("rejects a malformed cursor instead of paging from the epoch", () => {
    // Decoding garbage to `new Date(NaN)` would silently return page one.
    expect(decodeFillCursor("nonsense")).toBeNull();
    expect(decodeFillCursor("not-a-date|abc")).toBeNull();
    expect(decodeFillCursor("2026-08-30T10:00:00.000Z|")).toBeNull();
  });
});
