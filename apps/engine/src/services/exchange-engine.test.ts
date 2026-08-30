import { describe, expect, it } from "bun:test";
import { MARKETS } from "@repo/db/markets";
import { createExchangeStore } from "../store";
import { createEngine } from "./exchange-engine";

/**
 * Market orders, which for a long time could not fill at all.
 *
 * `placeOrder` computed the slippage-bounded entry price — the worst price the
 * trader has agreed to accept — and then assigned the slippage PERCENT to
 * `normalizedPayload.price` instead of that price. Both matching loops bound
 * themselves by `currentOrder.price` (`<=` for a long, `>=` for a short), so a
 * long market order could only reach asks priced under $1 and a short could
 * only reach bids priced over it. Every market order came back `cancelled`
 * with `filledQty: 0`, after its margin had already been locked.
 *
 * These drive the real engine over its own `handle` entry point — no Redis, no
 * S3 — so the assertions are about matching behaviour rather than transport.
 */

const SOL = MARKETS.SOL.id;
const BTC = MARKETS.BTC.id;
const MAKER = "11111111-1111-4111-8111-111111111111";
const TAKER = "22222222-2222-4222-8222-222222222222";

let orderSeq = 0;

const DEFAULT_USERS = { maker: MAKER, taker: TAKER };

function engine(who: { maker: string; taker: string } = DEFAULT_USERS) {
  const store = createExchangeStore();
  const uploadToS3 = (async () => undefined) as never;
  const api = createEngine({ store, uploadToS3 });

  const send = (type: string, payload: Record<string, unknown>) =>
    api.handle({
      type,
      payload,
      messageId: `m-${++orderSeq}`,
    } as never) as { backend: Record<string, unknown> } | undefined;

  const fund = (userId: string, amount: number) =>
    send("onramp", { userId, amount });

  /** An `orders` row as the backend inserts it before calling the engine. */
  const order = (over: Record<string, unknown>) => ({
    id: `00000000-0000-4000-8000-${String(++orderSeq).padStart(12, "0")}`,
    userId: who.taker,
    marketId: SOL,
    positionType: "LONG",
    orderType: "limit",
    status: "pending",
    qty: "1",
    filledQty: "0",
    price: "0",
    slippage: 0,
    initialMargin: "100",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  const place = (over: Record<string, unknown>) =>
    send("create_order", order(over))?.backend as {
      orderId: string;
      status: string;
      filledQty: number;
      averagePrice: number;
      totalPrice: number;
    };

  /**
   * Cancels through the same `handle` entry point the backend uses.
   *
   * `over` is the Postgres `orders` row, deliberately passed in whole: the
   * engine reads `positionType`, `price` and `id` off it to find the level, and
   * one of the bugs below is about what it does NOT read off it.
   */
  const cancel = (over: Record<string, unknown>) =>
    send("cancel_order", order(over))?.backend as {
      cancelledQty: number;
      balances: { releasedMargin: number; available: number; locked: number };
    };

  /** The whole cancel response — `wsUser` is not on `backend`. */
  const cancelRaw = (over: Record<string, unknown>) =>
    send("cancel_order", order(over)) as unknown as {
      wsUser?: Record<string, TUserEvent[]>;
    };

  const onrampRaw = (userId: string, amount: number) =>
    send("onramp", { userId, amount }) as unknown as {
      wsUser?: Record<string, TUserEvent[]>;
    };

  const balances = (userId: string) =>
    send("get_balances", { userId })?.backend as {
      balances: { available: number; locked: number };
    };

  const openPositions = (userId: string, marketId = SOL) =>
    send("get_open_positions_for_market", { userId, marketId })?.backend as {
      positions: {
        marketId: string;
        type: "LONG" | "SHORT";
        qty: number;
        margin: number;
        averagePrice: number;
      }[];
    };

  /**
   * The whole engine response, not just `backend`.
   *
   * `writer` is what db-writer applies to Postgres, and it is a SEPARATE
   * payload from the one the API returns — which is exactly how the two came
   * to disagree. Anything asserting on what is persisted has to read this.
   */
  const placeRaw = (over: Record<string, unknown>) =>
    send("create_order", order(over)) as unknown as {
      backend: { orderId: string; status: string; filledQty: number };
      writer: {
        table: string;
        data: Record<string, unknown>[];
      }[];
      wsServer: {
        depth: { bids: [string, string][]; asks: [string, string][] };
        lastTradedPrice: string;
        indexPrice: string;
        trades: {
          id: string;
          price: string;
          qty: string;
          side: "buy" | "sell";
          ts: number;
        }[];
      };
      wsUser?: Record<string, TUserEvent[]>;
    };

  /** The `order_updates` rows from one response, by order id. */
  const orderUpdates = (res: ReturnType<typeof placeRaw>) =>
    new Map(
      (res.writer.find((w) => w.table === "order_updates")?.data ?? []).map(
        (row) => [
          row.orderId as string,
          row as { orderId: string; status: string; filledQty: number },
        ],
      ),
    );

  /** The `fills` rows from one response, as db-writer would insert them. */
  const fillInserts = (res: ReturnType<typeof placeRaw>) =>
    (res.writer.find((w) => w.table === "fills")?.data ?? []) as {
      id?: string;
      price: string;
      qty: string;
      makerId: string;
      takerId: string;
    }[];

  /** A spot tick, exactly as apps/price-poller sends it. */
  const spot = (asset: "SOL" | "ETH" | "BTC", price: number) =>
    send("spot_price_update", { [asset]: price }) as unknown as {
      wsServer: {
        indexPrice: string;
        lastTradedPrice: string;
        trades: { side: "buy" | "sell"; price: string; qty: string }[];
      } | null;
      wsUser?: Record<string, TUserEvent[]>;
    };

  const fundingDispersal = () => send("funding_rate_dispersal", {});

  return {
    who,
    store,
    fund,
    place,
    placeRaw,
    orderUpdates,
    fillInserts,
    spot,
    fundingDispersal,
    cancel,
    cancelRaw,
    onrampRaw,
    balances,
    openPositions,
  };
}

/** Loosely typed on purpose — the wire schema is asserted in @repo/shared. */
type TUserEvent = { type: string } & Record<string, any>;

/** One account's events from a reply, in the order the engine emitted them. */
const eventsFor = (
  res: { wsUser?: Record<string, TUserEvent[]> },
  userId: string,
): TUserEvent[] => res.wsUser?.[userId] ?? [];

const eventsOfType = (
  res: { wsUser?: Record<string, TUserEvent[]> },
  userId: string,
  type: string,
) => eventsFor(res, userId).filter((e) => e.type === type);

/** A resting ask at `price`, left by a maker who can afford it. */
function bookWithAsk(price: number, qty = 5, who = DEFAULT_USERS) {
  const e = engine(who);
  e.fund(who.maker, 1_000_000);
  e.fund(who.taker, 1_000_000);
  e.place({
    userId: who.maker,
    positionType: "SHORT",
    orderType: "limit",
    price: `${price}`,
    qty: `${qty}`,
    initialMargin: `${price * qty}`,
  });
  return e;
}

describe("market orders", () => {
  it("fills a long against the resting ask", () => {
    const e = bookWithAsk(105);

    const result = e.place({
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 1,
      qty: "1",
      initialMargin: "21",
    });

    // Before the fix: `cancelled`, filledQty 0, margin locked for nothing.
    expect(result.status).toBe("filled");
    expect(result.filledQty).toBe(1);
    expect(result.averagePrice).toBe(105);
  });

  it("fills a short against the resting bid", () => {
    const e = engine();
    e.fund(MAKER, 1_000_000);
    e.fund(TAKER, 1_000_000);
    e.place({
      userId: MAKER,
      positionType: "LONG",
      orderType: "limit",
      price: "95",
      qty: "5",
      initialMargin: "475",
    });

    const result = e.place({
      positionType: "SHORT",
      orderType: "market",
      price: "0",
      slippage: 1,
      qty: "2",
      initialMargin: "190",
    });

    expect(result.status).toBe("filled");
    expect(result.filledQty).toBe(2);
    expect(result.averagePrice).toBe(95);
  });

  it("stops at the slippage band instead of sweeping the book", () => {
    // Asks at 105 and 200. A 1% band from 105 reaches 106.05, so the second
    // level is out of reach and the remainder is cancelled, not filled at 200.
    const e = bookWithAsk(105, 1);
    e.place({
      userId: MAKER,
      positionType: "SHORT",
      orderType: "limit",
      price: "200",
      qty: "5",
      initialMargin: "1000",
    });

    const result = e.place({
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 1,
      qty: "3",
      initialMargin: "100",
    });

    expect(result.filledQty).toBe(1);
    expect(result.averagePrice).toBe(105);
    // The unfillable remainder of a market order is cancelled, never rested.
    expect(result.status).toBe("cancelled");
  });

  it("widens with the band: 100% slippage reaches the second level", () => {
    const e = bookWithAsk(105, 1);
    e.place({
      userId: MAKER,
      positionType: "SHORT",
      orderType: "limit",
      price: "200",
      qty: "5",
      initialMargin: "1000",
    });

    const result = e.place({
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 100,
      qty: "3",
      initialMargin: "1000",
    });

    expect(result.status).toBe("filled");
    expect(result.filledQty).toBe(3);
    // One at 105, two at 200.
    expect(result.totalPrice).toBe(505);
  });

  it("refuses an empty book rather than pretending to fill", () => {
    const e = engine();
    e.fund(TAKER, 1000);
    expect(() =>
      e.place({
        positionType: "LONG",
        orderType: "market",
        price: "0",
        slippage: 1,
        qty: "1",
        initialMargin: "100",
      }),
    ).toThrow("There are no matches available");
  });

  it("enforces the leverage cap, which it could not do before", () => {
    // SOL's cap is 30x. 1 SOL at ~105 on $1 of margin is ~105x. The old code
    // computed `slippage * qty / margin` here — 1 * 1 / 1 — and waved it
    // through, so the cap simply did not apply to market orders.
    const e = bookWithAsk(105);
    expect(() =>
      e.place({
        positionType: "LONG",
        orderType: "market",
        price: "0",
        slippage: 1,
        qty: "1",
        initialMargin: "1",
      }),
    ).toThrow("Leverage not supported");
  });

  it("leaves the trader's own slippage figure alone", () => {
    // `price` is the bound the matcher reads; `slippage` is what the user asked
    // for, and it is what gets echoed back and persisted.
    const e = bookWithAsk(105);
    const before = e.store.orderbooks[SOL]!.lastTradedPrice;
    const result = e.place({
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 3,
      qty: "1",
      initialMargin: "21",
    });
    expect(result.status).toBe("filled");
    expect(e.store.orderbooks[SOL]!.lastTradedPrice).toBe(105);
    expect(before).not.toBe(105);
  });
});

/**
 * Cancelling a resting order, which used to corrupt the book (G26).
 *
 * `cancelOrder` looked the level up on the correct side and then cleaned up with
 * an unconditional ``delete orderbook.asks[`${order.price}`]`` — in the LONG
 * branch as well as the SHORT one. Two consequences, and these tests are one
 * apiece: the emptied BID level was never removed, and any ask sitting at the
 * same price was removed instead.
 *
 * A third test covers the quantity the level is decremented by, which was read
 * off the Postgres row rather than off the engine's own open order.
 */

/**
 * A user nobody else in this file has touched.
 *
 * `createExchangeStore` hands every store the SAME module-level `users` map, so
 * collateral survives across `engine()` instances even though the orderbooks do
 * not. Any assertion about a balance has to start from an id of its own.
 */
let userSeq = 0;
const freshUser = () =>
  `33333333-3333-4333-8333-${String(++userSeq).padStart(12, "0")}`;

/**
 * The same isolation, for a test that needs both sides of a trade.
 *
 * A spot tick is the case that forces it: `liqudationChecks` sweeps every user
 * in the shared map, so a position another test left behind is examined — and
 * liquidated — by this one's tick.
 */
const freshUsers = () => ({ maker: freshUser(), taker: freshUser() });

/** A bid that cannot cross anything: priced far below every book in this file. */
function restingBid(
  e: ReturnType<typeof engine>,
  opts: { userId: string; price: number; qty: number },
) {
  const { orderId } = e.place({
    userId: opts.userId,
    positionType: "LONG",
    orderType: "limit",
    price: `${opts.price}`,
    qty: `${opts.qty}`,
    initialMargin: `${opts.price * opts.qty}`,
  });
  return {
    id: orderId,
    userId: opts.userId,
    positionType: "LONG",
    orderType: "limit",
    price: `${opts.price}`,
    qty: `${opts.qty}`,
    filledQty: "0",
    initialMargin: `${opts.price * opts.qty}`,
  };
}

describe("cancelling a resting order", () => {
  it("removes the level it emptied, on its own side", () => {
    const e = engine();
    e.fund(TAKER, 1_000_000);
    const bid = restingBid(e, { userId: TAKER, price: 40, qty: 2 });

    expect(e.store.orderbooks[SOL]!.bids["40"]).toBeDefined();
    e.cancel(bid);

    // Before the fix this asserted nothing about `asks` and everything about
    // `bids` failed: the bid level survived with `availableQty: 0` and an empty
    // `openOrders`, because the delete named the wrong side.
    expect(e.store.orderbooks[SOL]!.bids["40"]).toBeUndefined();
  });

  it("does not touch the opposite side at the same price", () => {
    const e = engine();
    e.fund(TAKER, 1_000_000);
    const bid = restingBid(e, { userId: TAKER, price: 40, qty: 2 });

    /**
     * The ask is seeded straight into the store rather than placed.
     *
     * A bid and an ask at the same price cannot coexist through `handle` today —
     * the matcher would cross them — so this constructs the collision the old
     * delete was blind to. The invariant being pinned is that cancel is
     * side-local, which is what makes the guarantee survive any future change to
     * how levels are keyed.
     */
    e.store.orderbooks[SOL]!.asks["40"] = {
      availableQty: 7,
      openOrders: [
        {
          userId: MAKER,
          qty: 7,
          filledQty: 0,
          orderId: "99999999-9999-4999-8999-999999999999",
          status: "open",
          margin: 280,
          marketId: SOL,
          positionType: "SHORT",
          createdAt: new Date(),
        },
      ],
    };

    e.cancel(bid);

    // This is the liquidity the old code silently deleted — someone else's.
    expect(e.store.orderbooks[SOL]!.asks["40"]).toBeDefined();
    expect(e.store.orderbooks[SOL]!.asks["40"]!.availableQty).toBe(7);
    expect(e.store.orderbooks[SOL]!.bids["40"]).toBeUndefined();
  });

  it("leaves the rest of the level alone when another order is resting on it", () => {
    const e = engine();
    e.fund(MAKER, 1_000_000);
    e.fund(TAKER, 1_000_000);
    const mine = restingBid(e, { userId: TAKER, price: 40, qty: 2 });
    restingBid(e, { userId: MAKER, price: 40, qty: 3 });

    expect(e.store.orderbooks[SOL]!.bids["40"]!.availableQty).toBe(5);
    e.cancel(mine);

    const level = e.store.orderbooks[SOL]!.bids["40"];
    expect(level).toBeDefined();
    expect(level!.availableQty).toBe(3);
    expect(level!.openOrders).toHaveLength(1);
    expect(level!.openOrders[0]!.userId).toBe(MAKER);
  });

  it("takes off the engine's remaining quantity, not the database row's", () => {
    const e = engine();
    e.fund(MAKER, 1_000_000);
    e.fund(TAKER, 1_000_000);
    // TAKER is first on the level, so it is the one the incoming sell hits.
    const mine = restingBid(e, { userId: TAKER, price: 40, qty: 5 });
    restingBid(e, { userId: MAKER, price: 40, qty: 4 });

    e.place({
      userId: MAKER,
      positionType: "SHORT",
      orderType: "limit",
      price: "40",
      qty: "2",
      initialMargin: "80",
    });
    expect(e.store.orderbooks[SOL]!.bids["40"]!.availableQty).toBe(7);

    /**
     * The row still says `filledQty: "0"` — db-writer applies `order_updates`
     * asynchronously, so this is the normal state of affairs, not a contrived
     * one. The old code subtracted 5 and left the level claiming 2 when MAKER
     * still had 4 resting on it.
     */
    const stale = { ...mine, filledQty: "0" };
    const result = e.cancel(stale);

    expect(result.cancelledQty).toBe(3);
    expect(e.store.orderbooks[SOL]!.bids["40"]!.availableQty).toBe(4);
  });

  it("returns the margin the order was still holding", () => {
    const e = engine();
    const trader = freshUser();
    e.fund(trader, 1_000);
    const bid = restingBid(e, { userId: trader, price: 40, qty: 2 });

    expect(e.balances(trader).balances.locked).toBe(80);

    const result = e.cancel(bid);
    expect(result.balances.releasedMargin).toBe(80);
    expect(result.balances.available).toBe(1_000);
    expect(result.balances.locked).toBe(0);
  });

  it("refuses an order that is not on the book", () => {
    const e = engine();
    const trader = freshUser();
    e.fund(trader, 1_000);
    const bid = restingBid(e, { userId: trader, price: 40, qty: 2 });
    e.cancel(bid);

    // Cancelling twice must not release the margin twice.
    expect(() => e.cancel(bid)).toThrow("Order not found");
    expect(e.balances(trader).balances.locked).toBe(0);
    expect(e.balances(trader).balances.available).toBe(1_000);
  });
});

/**
 * Positions, and the close that Phase 9's UI depends on.
 *
 * Two engine defects are pinned here. Both are about a value arriving as a
 * STRING from Postgres and being tested for truthiness as though it were a
 * number, or about an absent user being treated as an error rather than an
 * answer — the same class of thing in two places.
 */
describe("reading positions", () => {
  it("returns an empty list for a user the engine has never seen", () => {
    // This used to throw "User has no positions", which the backend turns into
    // a 400 and the browser into a failed panel. The store is in-memory, so an
    // unknown user is ordinary: a restart, or a positions request that lands
    // before the balances request that creates the row.
    const e = engine();
    expect(e.openPositions(freshUser()).positions).toEqual([]);
  });

  it("does not create the user as a side effect of reading", () => {
    // `get_balances` creates on read; a list read must not.
    const e = engine();
    const trader = freshUser();
    e.openPositions(trader);
    expect(e.store.users.has(trader)).toBe(false);
  });

  it("returns only the requested market's positions", () => {
    const e = bookWithAsk(105, 5);
    const trader = freshUser();
    e.fund(trader, 10_000);
    e.place({
      userId: trader,
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "2",
      initialMargin: "210",
    });

    expect(e.openPositions(trader, SOL).positions).toHaveLength(1);
    expect(e.openPositions(trader, MARKETS.ETH.id).positions).toEqual([]);
  });
});

describe("closing a position with no margin (G13)", () => {
  /** Opens a LONG by crossing a resting ask, and leaves a bid to close into. */
  function longWithExit(qty: number) {
    const e = bookWithAsk(105, 10);
    const trader = freshUser();
    e.fund(trader, 100_000);
    e.place({
      userId: trader,
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: `${qty}`,
      initialMargin: `${105 * qty}`,
    });
    // Somebody willing to buy it back, so the close has something to match.
    e.place({
      userId: MAKER,
      positionType: "LONG",
      orderType: "limit",
      price: "104",
      qty: `${qty}`,
      initialMargin: `${104 * qty}`,
    });
    return { e, trader };
  }

  it("flattens the position and locks no additional margin", () => {
    const { e, trader } = longWithExit(2);
    expect(e.openPositions(trader).positions).toHaveLength(1);

    const result = e.place({
      userId: trader,
      positionType: "SHORT",
      orderType: "market",
      price: "0",
      slippage: 1,
      qty: "2",
      // What the backend inserts when the client omits `equity` — a STRING zero.
      initialMargin: "0",
    });

    expect(result.filledQty).toBe(2);
    expect(e.openPositions(trader).positions).toEqual([]);
    // "Closing a position never leaves margin locked" — the phase's own
    // acceptance criterion, asserted against the engine's collateral.
    expect(e.balances(trader).balances.locked).toBe(0);
  });

  it("names the real reason when there is no position to reduce", () => {
    /**
     * The string-truthiness bug. `initialMargin` arrives as `"0"` and `!"0"` is
     * `false`, so an order with no margin fell past this guard entirely and
     * failed further down as `leverage = price * qty / 0` — reported as
     * "Leverage not supported", which sends the reader to the wrong problem.
     */
    const e = bookWithAsk(105, 5);
    const trader = freshUser();
    e.fund(trader, 10_000);

    expect(() =>
      e.place({
        userId: trader,
        positionType: "LONG",
        orderType: "market",
        price: "0",
        slippage: 1,
        qty: "1",
        initialMargin: "0",
      }),
    ).toThrow("Margin required as there is no open position for this market");
  });

  it("refuses a same-side order with no margin as risk INCREASING", () => {
    // Same bug, second guarded message: doubling a position is not a close, and
    // must not be free.
    const { e, trader } = longWithExit(2);

    expect(() =>
      e.place({
        userId: trader,
        positionType: "LONG",
        orderType: "market",
        price: "0",
        slippage: 1,
        qty: "1",
        initialMargin: "0",
      }),
    ).toThrow("Margin required as this is a risk increasing order");
  });
});

describe("what is persisted about an aggressive order", () => {
  /**
   * The taker's `order_updates` row carried `filledQty: 0` however much it had
   * just executed.
   *
   * `matchLongOrder` and `matchShortOrder` each accumulate the executed size in
   * a local, `filledQtyForCurrentOrder`, and each used it for the API reply and
   * for the in-memory open order — but pushed `currentOrder.filledQty` to the
   * writer. `currentOrder` is the Postgres row the backend inserted before the
   * engine saw it, so that field is the `"0"` it was created with and nothing
   * increments it.
   *
   * The API reply was right, which is why Phase 7's ticket looked correct and
   * why this survived three phases. It only becomes visible when a FINISHED
   * order's Filled column reaches a screen, which is Phase 10's order history:
   * `status: "filled"` beside `Filled: 0.00`.
   *
   * The maker's row was always right — its update is built from the resting
   * open order, which is the engine's own object.
   */
  it("persists what a fully filling taker actually executed", () => {
    const e = bookWithAsk(105, 5);
    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "2",
      initialMargin: "210",
    });

    expect(res.backend.status).toBe("filled");
    expect(res.backend.filledQty).toBe(2);

    const update = e.orderUpdates(res).get(res.backend.orderId);
    expect(update).toBeDefined();
    expect(update!.status).toBe("filled");
    // Was 0 — a filled order recorded as having filled nothing.
    expect(update!.filledQty).toBe(2);
  });

  it("persists the executed part of a partial fill", () => {
    const e = bookWithAsk(105, 1);
    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "4",
      initialMargin: "420",
    });

    expect(res.backend.status).toBe("partially_filled");
    const update = e.orderUpdates(res).get(res.backend.orderId);
    expect(update!.filledQty).toBe(1);
    // And the remainder is resting, which is the other half of the same claim.
    expect(update!.status).toBe("partially_filled");
  });

  it("persists a market order's executed quantity too", () => {
    const e = bookWithAsk(105, 5);
    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "market",
      price: "0",
      qty: "3",
      slippage: 10,
      initialMargin: "400",
    });

    expect(res.backend.filledQty).toBe(3);
    expect(e.orderUpdates(res).get(res.backend.orderId)!.filledQty).toBe(3);
  });

  it("does the same for a short taker", () => {
    // Both matching loops carried the bug; fixing one would leave sells wrong.
    const e = engine();
    e.fund(MAKER, 1_000_000);
    e.fund(TAKER, 1_000_000);
    e.place({
      userId: MAKER,
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "5",
      initialMargin: "525",
    });

    const res = e.placeRaw({
      positionType: "SHORT",
      orderType: "limit",
      price: "105",
      qty: "2",
      initialMargin: "210",
    });

    expect(res.backend.filledQty).toBe(2);
    expect(e.orderUpdates(res).get(res.backend.orderId)!.filledQty).toBe(2);
  });

  it("still reports the maker's fill correctly", () => {
    // The half that was never broken. Both rows are in the same payload, and a
    // fix that overwrote the maker's would be a worse bug than the original.
    const e = bookWithAsk(105, 2);
    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "2",
      initialMargin: "210",
    });

    const updates = e.orderUpdates(res);
    const maker = [...updates.values()].find(
      (u) => u.orderId !== res.backend.orderId,
    );
    expect(maker).toBeDefined();
    expect(maker!.filledQty).toBe(2);
    expect(maker!.status).toBe("filled");
  });
});

/**
 * Phase 12 — the index price, and the public tape.
 *
 * `orderbook.indexPrice` was assigned exactly once, when the store was created,
 * and then never again. Everything downstream of it was therefore either frozen
 * (the `mark-price` feed, G15) or arithmetic against a constant (the funding
 * rate). The fix is one line at the top of `liqudationChecks` — the only place
 * in the engine that is ever handed a spot price.
 */
describe("the index price", () => {
  it("takes the spot price the poller just delivered", () => {
    const e = engine();
    const res = e.spot("SOL", 212.5);
    // Was "85" — the seed — no matter what Binance said.
    expect(res.wsServer!.indexPrice).toBe("212.5");
  });

  it("keeps each market's index separate", () => {
    const e = engine();
    e.spot("SOL", 212.5);
    const eth = e.spot("ETH", 3_100);

    expect(eth.wsServer!.indexPrice).toBe("3100");
    expect(e.spot("SOL", 212.5).wsServer!.indexPrice).toBe("212.5");
  });

  it("is what a placed order broadcasts too, not the seed", () => {
    // The mark on the market bar has to agree whichever engine reply carried
    // it: a spot tick and an order are two different code paths that both build
    // a `wsServer` payload.
    const e = bookWithAsk(105, 5);
    e.spot("SOL", 212.5);

    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "1",
      initialMargin: "105",
    });
    expect(res.wsServer.indexPrice).toBe("212.5");
  });

  /**
   * `disperseFundingRate` computes `(lastTraded − index) / index`. With the
   * index pinned at the seed that ratio never reflected the market, so the
   * hourly funding every open position paid was derived from a number nobody
   * had quoted. This asserts the mechanism moved, not a particular figure.
   */
  it("makes the funding rate follow the market instead of the seed", () => {
    const settle = (spotPrice: number) => {
      // A long opened at 105 against a resting ask, then funded once. Fresh
      // users: a spot tick sweeps every account in the shared map.
      const who = freshUsers();
      const e = bookWithAsk(105, 5, who);
      e.placeRaw({
        positionType: "LONG",
        orderType: "limit",
        price: "105",
        qty: "1",
        initialMargin: "105",
      });
      e.spot("SOL", spotPrice);
      e.fundingDispersal();
      return e.openPositions(who.taker).positions[0]!.margin;
    };

    // Last traded is 105 either way; only the index differs, so any difference
    // in the margin left after funding is the index doing its job.
    expect(settle(90)).not.toBe(settle(200));
  });
});

describe("the public tape", () => {
  it("publishes a print for every level a taker crossed", () => {
    const e = engine();
    e.fund(MAKER, 1_000_000);
    e.fund(TAKER, 1_000_000);
    for (const price of [105, 106]) {
      e.place({
        userId: MAKER,
        positionType: "SHORT",
        orderType: "limit",
        price: `${price}`,
        qty: "1",
        initialMargin: `${price}`,
      });
    }

    // One order, two levels: two trades at two prices. A single print at one of
    // them would misreport the sweep.
    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "106",
      qty: "2",
      initialMargin: "212",
    });

    expect(res.backend.filledQty).toBe(2);
    expect(res.wsServer.trades.map((t) => t.price)).toEqual(["105", "106"]);
    expect(res.wsServer.trades.map((t) => t.qty)).toEqual(["1", "1"]);
  });

  it("reports the aggressor's side, not the maker's", () => {
    // A print says what someone did TO the book. A buyer lifting a resting ask
    // is a buy, even though the fill's other half is a sale.
    const buy = bookWithAsk(105, 2).placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "1",
      initialMargin: "105",
    });
    expect(buy.wsServer.trades[0]!.side).toBe("buy");

    const e = engine();
    e.fund(MAKER, 1_000_000);
    e.fund(TAKER, 1_000_000);
    e.place({
      userId: MAKER,
      positionType: "LONG",
      orderType: "limit",
      price: "95",
      qty: "2",
      initialMargin: "190",
    });
    const sell = e.placeRaw({
      positionType: "SHORT",
      orderType: "limit",
      price: "95",
      qty: "1",
      initialMargin: "95",
    });
    expect(sell.wsServer.trades[0]!.side).toBe("sell");
  });

  it("carries no account or order identity", () => {
    // This socket is unauthenticated. The absence has to hold in the payload
    // the engine emits, not in what the broadcaster remembers to strip.
    const res = bookWithAsk(105, 2).placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "1",
      initialMargin: "105",
    });

    expect(Object.keys(res.wsServer.trades[0]!).sort()).toEqual([
      "id",
      "price",
      "qty",
      "side",
      "ts",
    ]);
  });

  it("gives a print the same id as the fill it will be persisted as", () => {
    // The tape and the account's own Fills tab are then two views of one trade
    // rather than two records nothing can join.
    const e = bookWithAsk(105, 2);
    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "1",
      initialMargin: "105",
    });

    const fills = e.fillInserts(res);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.id).toBe(res.wsServer.trades[0]!.id);
    expect(fills[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("publishes nothing when an order rests without trading", () => {
    const e = engine();
    e.fund(TAKER, 1_000_000);
    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "90",
      qty: "1",
      initialMargin: "90",
    });

    expect(res.backend.status).toBe("open");
    expect(res.wsServer.trades).toEqual([]);
  });

  it("puts a forced close on the tape as well", () => {
    // A liquidation is a real trade at a real price and the market can see it.
    // It reaches the wire by a different path — `liqudationChecks` builds its
    // own payload — so it needs its own assertion.
    const who = freshUsers();
    const e = engine(who);
    e.fund(who.maker, 1_000_000);
    e.fund(who.taker, 1_000_000);

    // A short opened at 100 on thin margin — liquidated a little over 110.
    e.place({
      userId: who.maker,
      positionType: "LONG",
      orderType: "limit",
      price: "100",
      qty: "1",
      initialMargin: "100",
    });
    e.place({
      positionType: "SHORT",
      orderType: "limit",
      price: "100",
      qty: "1",
      initialMargin: "10",
    });
    // Closing a short is a market BUY, so what it needs resting is an ASK.
    e.place({
      userId: who.maker,
      positionType: "SHORT",
      orderType: "limit",
      price: "150",
      qty: "5",
      initialMargin: "750",
    });

    const position = e.openPositions(who.taker).positions[0]!;
    expect(position.type).toBe("SHORT");

    const res = e.spot("SOL", 100_000);
    // The liquidating order is a market BUY, so the print is a buy.
    expect(res.wsServer!.trades.length).toBeGreaterThan(0);
    expect(res.wsServer!.trades[0]!.side).toBe("buy");
  });
});

/**
 * The book a broadcast describes is the book after the order that caused it.
 *
 * `placeOrder` built its `wsServer` payload BEFORE calling `matchOrder`, so the
 * depth frame that followed an order described the state it had just left: a
 * resting order was published as a level that did not exist yet, and a crossing
 * trade published the previous trade's price as `last-traded-price`. The price
 * poller's next sweep corrected both within a second, which is exactly why it
 * was never noticed.
 */
describe("what a broadcast describes", () => {
  it("shows a resting order on the book it was published with", () => {
    const e = engine();
    e.fund(TAKER, 1_000_000);
    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "90",
      qty: "1",
      initialMargin: "90",
    });

    expect(res.backend.status).toBe("open");
    // Was []: the depth snapshot was taken before the order joined the book.
    expect(res.wsServer.depth.bids).toContainEqual(["90", "1"]);
  });

  it("shows the price of the trade it is reporting, not the one before it", () => {
    const e = bookWithAsk(105, 5);
    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "1",
      initialMargin: "105",
    });

    expect(res.backend.filledQty).toBe(1);
    // Was "90", the SOL seed — the last price before this trade happened.
    expect(res.wsServer.lastTradedPrice).toBe("105");
  });

  it("removes the liquidity a taker consumed", () => {
    const e = bookWithAsk(105, 2);
    const res = e.placeRaw({
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "2",
      initialMargin: "210",
    });

    expect(res.wsServer.depth.asks).toEqual([]);
  });
});

/**
 * The private user channel (Phase 13).
 *
 * The public tape above is defined by what it must NOT carry. This is the
 * opposite payload — everything an account is entitled to know about its own
 * trading — and the assertions are about three things the engine is the only
 * process able to answer:
 *
 *   1. **Who a trade concerns.** A `fills` row names two accounts and records
 *      no direction; only the match function knows which of them was the
 *      aggressor.
 *   2. **What the account holds afterwards.** Netting, the weighted average
 *      price and the liquidation price are engine arithmetic. A client
 *      re-deriving them would be a second risk model, and it would be the one
 *      that disagrees with the one that actually liquidates people.
 *   3. **That nobody else's events are in the batch.** The isolation is a
 *      property of the keys of `wsUser`, because ws-server publishes them
 *      verbatim to `user:{id}` without inspecting anything.
 */
describe("the private user channel", () => {
  it("tells the MAKER their resting order filled — the case that needs no request", () => {
    // The whole reason this phase exists. The maker submitted nothing at the
    // moment of the fill, so before this channel their only way to learn about
    // it was to ask again, and nothing told them when to ask.
    const who = freshUsers();
    const e = bookWithAsk(105, 5, who);

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 10,
      qty: "2",
      initialMargin: "300",
    });

    const makerFills = eventsOfType(res, who.maker, "fill");
    expect(makerFills).toHaveLength(1);
    expect(makerFills[0]!.role).toBe("maker");
    // The maker rested an ask, so the maker is SHORT — the mirror of the
    // aggressor, which is the only side a fill row could ever imply.
    expect(makerFills[0]!.side).toBe("SHORT");
    expect(makerFills[0]!.price).toBe("105");
    expect(makerFills[0]!.qty).toBe("2");

    const makerUpdates = eventsOfType(res, who.maker, "order.update");
    expect(makerUpdates).toHaveLength(1);
    expect(makerUpdates[0]!.status).toBe("partially_filled");
    expect(makerUpdates[0]!.filledQty).toBe("2");
  });

  it("gives the two sides of one trade opposite sides and matching fill ids", () => {
    // One trade, two viewers. The shared id is what lets the tape, the Fills
    // tab and this event be recognised as one thing rather than three.
    const who = freshUsers();
    const e = bookWithAsk(105, 5, who);

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 10,
      qty: "2",
      initialMargin: "300",
    });

    const makerFill = eventsOfType(res, who.maker, "fill")[0]!;
    const takerFill = eventsOfType(res, who.taker, "fill")[0]!;

    expect(makerFill.fillId).toBe(takerFill.fillId);
    expect(makerFill.side).toBe("SHORT");
    expect(takerFill.side).toBe("LONG");
    expect(takerFill.role).toBe("taker");
    // Each side is told its OWN order, not the counterparty's.
    expect(makerFill.orderId).not.toBe(takerFill.orderId);
  });

  it("addresses only the accounts a reply actually touched", () => {
    // The isolation guarantee, asserted at its source. ws-server publishes
    // these keys straight to `user:{id}` and never inspects a payload, so a
    // third account appearing here would be a disclosure no downstream check
    // could catch.
    const who = freshUsers();
    const bystander = freshUser();
    const e = bookWithAsk(105, 5, who);
    e.fund(bystander, 10_000);

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 10,
      qty: "1",
      initialMargin: "200",
    });

    expect(Object.keys(res.wsUser ?? {}).sort()).toEqual(
      [who.maker, who.taker].sort(),
    );
    expect(eventsFor(res, bystander)).toEqual([]);
  });

  it("ends every batch on absolute state, not on something to be inferred", () => {
    // `position` and `balance` are read out of the store after the match and
    // are sent whether or not they moved. A client that had to work out
    // whether a fill implied a balance change would be a second copy of the
    // engine's accounting — and it would be the copy that is wrong.
    const who = freshUsers();
    const e = bookWithAsk(105, 5, who);

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 10,
      qty: "2",
      initialMargin: "300",
    });

    for (const userId of [who.maker, who.taker]) {
      const events = eventsFor(res, userId);
      // Last two, in this order: everything before them describes what
      // happened, these two describe what is now true.
      expect(events.at(-2)!.type).toBe("position");
      expect(events.at(-1)!.type).toBe("balance");
    }

    const takerPosition = eventsOfType(res, who.taker, "position")[0]!.position;
    expect(takerPosition).not.toBeNull();
    expect(takerPosition.type).toBe("LONG");
    expect(takerPosition.qty).toBe("2");
    // Not derivable from the fill: the engine's own liquidation arithmetic,
    // which for a LONG puts the liquidation price below the entry.
    expect(Number(takerPosition.liquidationPrice)).toBeLessThan(105);
    expect(Number.isFinite(Number(takerPosition.liquidationPrice))).toBe(true);

    const takerBalance = eventsOfType(res, who.taker, "balance")[0]!;
    expect(Number(takerBalance.locked)).toBeGreaterThan(0);
    expect(Number(takerBalance.available)).toBeGreaterThan(0);
  });

  it("reports a closed position as `null`, which is what removes the row", () => {
    // The alternative — omitting the event — is indistinguishable from "no
    // news", and the row the user just closed would sit on screen until
    // something else refetched it.
    const who = freshUsers();
    const e = bookWithAsk(105, 5, who);

    e.place({
      userId: who.taker,
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 10,
      qty: "2",
      initialMargin: "300",
    });

    // Someone has to be on the other side of the close.
    e.place({
      userId: who.maker,
      positionType: "LONG",
      orderType: "limit",
      price: "104",
      qty: "2",
      initialMargin: "300",
    });

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "SHORT",
      orderType: "market",
      price: "0",
      slippage: 10,
      qty: "2",
      // Omitted margin is what makes it risk-reducing (G13).
      initialMargin: "0",
    });

    expect(eventsOfType(res, who.taker, "position")[0]!.position).toBeNull();
  });

  it("emits `order.new` for an ordinary order, with the fields a row needs", () => {
    // §6.14 scoped `order.new` to liquidations. `order.update` carries no
    // price, quantity or side, so without this the account that just placed a
    // resting order still could not render its own row without refetching —
    // which is the refetch this phase deletes.
    const who = freshUsers();
    const e = engine(who);
    e.fund(who.taker, 100_000);

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "limit",
      price: "3",
      qty: "4",
      initialMargin: "12",
    });

    const created = eventsOfType(res, who.taker, "order.new");
    expect(created).toHaveLength(1);
    expect(created[0]!.origin).toBe("user");
    expect(created[0]!.order.status).toBe("open");
    expect(created[0]!.order.price).toBe("3");
    expect(created[0]!.order.qty).toBe("4");
    expect(created[0]!.order.positionType).toBe("LONG");
    expect(typeof created[0]!.order.createdAt).toBe("string");
  });

  it("puts `order.new` before `order.update` so a patch never precedes its row", () => {
    const who = freshUsers();
    const e = engine(who);
    e.fund(who.taker, 100_000);

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "limit",
      price: "3",
      qty: "4",
      initialMargin: "12",
    });

    const types = eventsFor(res, who.taker).map((e) => e.type);
    expect(types.indexOf("order.new")).toBeLessThan(types.indexOf("order.update"));
  });

  it("marks a liquidation order `origin: liquidation` — the account did not place it", () => {
    // The one order in the system nobody submitted. Without the flag it is
    // indistinguishable from an order the user placed and forgot about.
    //
    // On BTC, not SOL: `liqudationChecks` sweeps every account in the
    // module-level user map, and a SOL tick would drag in every position the
    // rest of this file has left lying around — including their liquidations
    // eating the ask this test rests. No other test in this file trades BTC.
    const who = freshUsers();
    const e = engine(who);
    e.fund(who.maker, 1_000_000);
    e.fund(who.taker, 1_000_000);

    // A bid for the SHORT to open against…
    e.place({
      marketId: BTC,
      userId: who.maker,
      positionType: "LONG",
      orderType: "limit",
      price: "100",
      qty: "1",
      initialMargin: "100",
    });
    e.place({
      marketId: BTC,
      userId: who.taker,
      positionType: "SHORT",
      orderType: "market",
      price: "0",
      slippage: 10,
      qty: "1",
      // Thin, but inside BTC's 8x cap — which is checked against the
      // slippage-padded entry, not the fill (see the market-order fix).
      initialMargin: "20",
    });
    // …and an ask for the forced close to buy into. A liquidated SHORT is a
    // market BUY, so an empty ask side is what makes it unclosable — see the
    // Phase 12 guard.
    e.place({
      marketId: BTC,
      userId: who.maker,
      positionType: "SHORT",
      orderType: "limit",
      price: "120",
      qty: "5",
      initialMargin: "600",
    });

    // A spot tick well above the short's liquidation price forces the close.
    const res = e.spot("BTC", 1000);

    const created = eventsOfType(res, who.taker, "order.new");
    expect(created).toHaveLength(1);
    expect(created[0]!.origin).toBe("liquidation");
    expect(created[0]!.order.orderType).toBe("market");
    // And they are told the position is gone, in the same batch.
    expect(eventsOfType(res, who.taker, "position").at(-1)!.position).toBeNull();
  });

  it("tells the canceller their order is cancelled and their margin is back", () => {
    const who = freshUsers();
    const e = engine(who);
    e.fund(who.taker, 100_000);
    const resting = restingBid(e, { userId: who.taker, price: 2, qty: 3 });

    const res = e.cancelRaw(resting);

    const update = eventsOfType(res, who.taker, "order.update")[0]!;
    expect(update.orderId).toBe(resting.id);
    expect(update.status).toBe("cancelled");
    expect(eventsOfType(res, who.taker, "balance")[0]!.locked).toBe("0");
    // Nobody else is involved in a cancel.
    expect(Object.keys(res.wsUser ?? {})).toEqual([who.taker]);
  });

  it("pushes a balance for a deposit, which has no order behind it", () => {
    // The one balance change with no trade attached. Without it the deposit
    // dialog would still have to refetch, and a second signed-in device would
    // never learn about the money at all.
    const who = freshUsers();
    const e = engine(who);

    const res = e.onrampRaw(who.taker, 500);

    expect(eventsFor(res, who.taker)).toEqual([
      { type: "balance", available: "500", locked: "0" },
    ]);
  });

  it("carries no counterparty identity inside an account's own events", () => {
    // A fill event names the viewer's own order and nothing else. The public
    // tape drops both ids; this one keeps the viewer's, which is the whole
    // difference between the two payloads.
    const who = freshUsers();
    const e = bookWithAsk(105, 5, who);

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 10,
      qty: "1",
      initialMargin: "200",
    });

    expect(JSON.stringify(eventsFor(res, who.maker))).not.toContain(who.taker);
    expect(JSON.stringify(eventsFor(res, who.taker))).not.toContain(who.maker);
  });

  it("gives one sweep across two levels two fills in ONE batch", () => {
    // The batch boundary is what lets the client raise one toast for one
    // trade. Two makers at two prices, one aggressive order.
    const who = freshUsers();
    const second = freshUser();
    const e = bookWithAsk(105, 1, who);
    e.fund(second, 1_000_000);
    e.place({
      userId: second,
      positionType: "SHORT",
      orderType: "limit",
      price: "106",
      qty: "1",
      initialMargin: "106",
    });

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "market",
      price: "0",
      slippage: 10,
      qty: "2",
      initialMargin: "400",
    });

    const takerFills = eventsOfType(res, who.taker, "fill");
    expect(takerFills).toHaveLength(2);
    expect(takerFills.map((f) => f.price).sort()).toEqual(["105", "106"]);
    // …and each maker hears only about their own.
    expect(eventsOfType(res, who.maker, "fill")).toHaveLength(1);
    expect(eventsOfType(res, second, "fill")).toHaveLength(1);
  });
});

/**
 * The sixth instance of the engine's oldest bug, caught before it shipped.
 *
 * `orders.price` (Phase 7), `orders.filledQty` (Phase 8),
 * `orders.initialMargin` (Phase 9) and `currentOrder.filledQty` in the writer
 * payload (Phase 10) were all the same mistake: **one quantity with two
 * representations, and the wrong one used.** `order.new` builds an order row
 * from `normalizedPayload`, which IS the Postgres row the backend inserted
 * before the engine saw the order — so its `filledQty` is the `"0"` it was
 * created with and nothing increments it.
 *
 * The tests below fail against `filledQty: order.filledQty`.
 */
describe("what `order.new` says an order filled", () => {
  it("reports the engine's accumulator on a partial fill, not the row's zero", () => {
    // The visible symptom of the row version: a resting order arriving with
    // `partially_filled` beside `0`, contradicting itself in two adjacent
    // columns of the Open-orders table.
    const who = freshUsers();
    const e = bookWithAsk(105, 2, who);

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "5",
      initialMargin: "600",
    });

    const created = eventsOfType(res, who.taker, "order.new")[0]!;
    expect(created.order.status).toBe("partially_filled");
    expect(created.order.filledQty).toBe("2");
    expect(created.order.qty).toBe("5");
  });

  it("agrees with the API reply and with `order_updates`", () => {
    // Three payloads describing one order. The Phase 10 defect was two of them
    // disagreeing, and a test that asserts on only one proves nothing about
    // the others.
    const who = freshUsers();
    const e = bookWithAsk(105, 2, who);

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "limit",
      price: "105",
      qty: "5",
      initialMargin: "600",
    });

    const created = eventsOfType(res, who.taker, "order.new")[0]!;
    const update = eventsOfType(res, who.taker, "order.update").at(-1)!;
    const persisted = e.orderUpdates(res).get(res.backend.orderId)!;

    expect(created.order.filledQty).toBe(`${res.backend.filledQty}`);
    expect(update.filledQty).toBe(`${res.backend.filledQty}`);
    expect(persisted.filledQty).toBe(res.backend.filledQty);
  });

  it("reports zero for an order that genuinely filled nothing", () => {
    const who = freshUsers();
    const e = engine(who);
    e.fund(who.taker, 100_000);

    const res = e.placeRaw({
      userId: who.taker,
      positionType: "LONG",
      orderType: "limit",
      price: "2",
      qty: "3",
      initialMargin: "6",
    });

    expect(eventsOfType(res, who.taker, "order.new")[0]!.order.filledQty).toBe("0");
  });
});
