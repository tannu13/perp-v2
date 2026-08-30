import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import db, { eq } from "@repo/db";
import { fills, orders, users } from "@repo/db/schema";
import { MARKETS } from "@repo/db/markets";
import type { TEngineResponseSchema } from "@repo/shared/redis-events";
import { createOrderService } from "./order-service";
import { AppError } from "../errors/app-error";

/**
 * Integration cover for the cancel-authorisation fix (G5) and the response
 * envelope (G7). Needs Postgres because both go through a real `orders` row;
 * the engine is stubbed, so nothing here needs Redis or a running engine.
 *
 * Skipped without a database rather than failing, so the suite stays runnable
 * with no stack up.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

type EngineCall = { type: string; payload: Record<string, unknown> };

let calls: EngineCall[] = [];

/**
 * How the stubbed engine answers `create_order`. `"reject"` is the shape the
 * comms layer produces when the engine throws — `ok: false` with the message —
 * and `"throw"` is a transport failure, which since Phase 1 includes a timeout.
 */
let createOrderBehaviour: "accept" | "reject" | "throw" = "accept";

const engineStub = ((type: string, payload: Record<string, unknown>) => {
  calls.push({ type, payload });

  if (type === "create_order" && createOrderBehaviour !== "accept") {
    if (createOrderBehaviour === "throw") {
      return Promise.reject(new Error("engine timed out"));
    }
    const rejection: TEngineResponseSchema = {
      correlationId: "test",
      ok: false,
      data: null as never,
      error: "User does not have available margin",
    };
    return Promise.resolve(rejection);
  }

  const reply: TEngineResponseSchema = {
    correlationId: "test",
    ok: true,
    data: {
      backend: { order: payload, cancelledQty: 1, balances: {} },
      writer: [{ table: "order_updates", data: [] }],
      wsServer: {
        depth: {
          market: MARKETS.SOL.id,
          lastUpdateId: 1,
          timestamp: 0,
          bids: [],
          asks: [],
        },
        lastTradedPrice: "90",
        indexPrice: "85",
      },
    },
    error: "",
  };
  return Promise.resolve(reply);
}) as never;

const service = createOrderService({ sendToEngine: engineStub });

const suffix = Date.now();
let alice = "";
let bob = "";
let aliceOrderId = "";

describeDb("cancelOrder authorisation (G5)", () => {
  beforeAll(async () => {
    const [a, b] = await db
      .insert(users)
      .values([
        {
          username: `authz-alice-${suffix}`,
          passwordHash: "x",
          name: "Alice",
        },
        { username: `authz-bob-${suffix}`, passwordHash: "x", name: "Bob" },
      ])
      .returning();
    alice = a!.id;
    bob = b!.id;

    const [order] = await db
      .insert(orders)
      .values({
        userId: alice,
        marketId: MARKETS.SOL.id,
        positionType: "LONG",
        orderType: "limit",
        status: "open",
        qty: "1",
        filledQty: "0",
        price: "95",
        slippage: 0,
        initialMargin: "95",
      })
      .returning();
    aliceOrderId = order!.id;
  });

  afterAll(async () => {
    if (aliceOrderId)
      await db.delete(orders).where(eq(orders.id, aliceOrderId));
    if (alice) await db.delete(users).where(eq(users.id, alice));
    if (bob) await db.delete(users).where(eq(users.id, bob));
  });

  it("lets the owner cancel their own order", async () => {
    calls = [];
    await service.cancelOrder(alice, aliceOrderId);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe("cancel_order");
  });

  it("refuses to cancel another user's order", async () => {
    calls = [];
    // Before the fix, this cancelled Alice's order — the service looked the row
    // up by id alone and never consulted the caller's identity.
    await expect(service.cancelOrder(bob, aliceOrderId)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("reports a foreign order as 404, not 403", async () => {
    // A 403 would confirm that someone else's order id is real.
    let caught: unknown;
    try {
      await service.cancelOrder(bob, aliceOrderId);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).statusCode).toBe(404);
    expect((caught as AppError).errorCode).toBe("RESOURCE_NOT_FOUND");
  });

  it("reports a genuinely missing order the same way", async () => {
    // Indistinguishable from the case above, which is the point.
    let caught: unknown;
    try {
      await service.cancelOrder(bob, "00000000-0000-0000-0000-0000000000ff");
    } catch (err) {
      caught = err;
    }
    expect((caught as AppError).statusCode).toBe(404);
  });

  it("returns only the client-facing payload (G7)", async () => {
    const response = (await service.cancelOrder(alice, aliceOrderId)) as Record<
      string,
      unknown
    >;
    expect(response).not.toHaveProperty("writer");
    expect(response).not.toHaveProperty("wsServer");
    expect(response).toHaveProperty("cancelledQty");
  });
});

describeDb("a rejected order leaves no pending row (G28)", () => {
  const suffix28 = `${Date.now()}-g28`;
  let trader = "";
  const created: string[] = [];

  const ordersFor = async (userId: string) =>
    db.query.orders.findMany({
      where: (row, { eq }) => eq(row.userId, userId),
    });

  const place = () =>
    service.createOrder(trader, {
      orderType: "limit",
      market: MARKETS.SOL.slug,
      type: "LONG",
      price: 95,
      slippage: 0,
      qty: 1,
      equity: 95,
    });

  beforeAll(async () => {
    const [row] = await db
      .insert(users)
      .values({
        username: `g28-trader-${suffix28}`,
        passwordHash: "x",
        name: "Trader",
      })
      .returning();
    trader = row!.id;
  });

  afterAll(async () => {
    createOrderBehaviour = "accept";
    for (const id of created) await db.delete(orders).where(eq(orders.id, id));
    if (trader) await db.delete(users).where(eq(users.id, trader));
  });

  it("retires the row as cancelled when the engine refuses the order", async () => {
    createOrderBehaviour = "reject";
    await expect(place()).rejects.toThrow(
      "User does not have available margin",
    );

    const rows = await ordersFor(trader);
    expect(rows).toHaveLength(1);
    created.push(rows[0]!.id);
    // Before the fix this was still "pending", and both /orders/open and
    // /orders returned it forever.
    expect(rows[0]!.status).toBe("cancelled");
  });

  it("does the same when the engine never answers at all", async () => {
    createOrderBehaviour = "throw";
    await expect(place()).rejects.toThrow("engine timed out");

    const rows = await ordersFor(trader);
    const latest = rows.find((r) => !created.includes(r.id));
    expect(latest).toBeDefined();
    created.push(latest!.id);
    expect(latest!.status).toBe("cancelled");
  });

  it("leaves the row alone when the engine accepts it", async () => {
    // The row stays `pending` until db-writer applies the engine's own
    // order_updates — retiring an accepted order here would erase a fill.
    createOrderBehaviour = "accept";
    await place();

    const rows = await ordersFor(trader);
    const latest = rows.find((r) => !created.includes(r.id));
    expect(latest).toBeDefined();
    created.push(latest!.id);
    expect(latest!.status).toBe("pending");
  });

  it("keeps a rejected order out of the open-orders list", async () => {
    // The whole point of G28: this is the query the Open-orders tab runs.
    const { orders: open } = await service.getOpenOrdersForMarket(
      trader,
      MARKETS.SOL.id,
    );
    expect(open.every((o) => o.status !== "cancelled")).toBe(true);
  });
});

describeDb("open orders are only the ones on the book (G27)", () => {
  /**
   * `getOpenOrdersForMarket` built its status filter as "every enum value except
   * cancelled", which kept `filled` and `pending`. The Open-orders tab would
   * have listed every order the account had ever filled in that market, each one
   * with a Cancel button the engine answers with "Order not found".
   *
   * Rows are inserted directly: this is a question about one query's predicate,
   * and driving the statuses through the engine would test the engine instead.
   */
  const suffix27 = `${Date.now()}-g27`;
  let trader = "";
  const inserted: string[] = [];

  const row = (status: "pending" | "open" | "partially_filled" | "filled" | "cancelled") => ({
    userId: trader,
    marketId: MARKETS.SOL.id,
    positionType: "LONG" as const,
    orderType: "limit" as const,
    status,
    qty: "1",
    filledQty: status === "partially_filled" ? "0.4" : "0",
    price: "95",
    slippage: 0,
    initialMargin: "95",
  });

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({
        username: `g27-trader-${suffix27}`,
        passwordHash: "x",
        name: "Trader",
      })
      .returning();
    trader = user!.id;

    const created = await db
      .insert(orders)
      .values([
        row("pending"),
        row("open"),
        row("partially_filled"),
        row("filled"),
        row("cancelled"),
      ])
      .returning();
    inserted.push(...created.map((o) => o.id));
  });

  afterAll(async () => {
    for (const id of inserted) await db.delete(orders).where(eq(orders.id, id));
    if (trader) await db.delete(users).where(eq(users.id, trader));
  });

  it("returns open and partially filled orders, and nothing else", async () => {
    const { orders: open } = await service.getOpenOrdersForMarket(
      trader,
      MARKETS.SOL.id,
    );
    expect(open.map((o) => o.status).sort()).toEqual([
      "open",
      "partially_filled",
    ]);
  });

  it("never returns a filled order", async () => {
    // The one that put a live Cancel button next to a terminal order.
    const { orders: open } = await service.getOpenOrdersForMarket(
      trader,
      MARKETS.SOL.id,
    );
    expect(open.some((o) => o.status === "filled")).toBe(false);
  });

  it("never returns a pending order", async () => {
    // `pending` means the engine has not acknowledged it, so it is not on the
    // book and cancelling it would 404 from the engine.
    const { orders: open } = await service.getOpenOrdersForMarket(
      trader,
      MARKETS.SOL.id,
    );
    expect(open.some((o) => o.status === "pending")).toBe(false);
  });

  it("still scopes to the caller and the market", async () => {
    const { orders: otherMarket } = await service.getOpenOrdersForMarket(
      trader,
      MARKETS.BTC.id,
    );
    expect(otherMarket).toHaveLength(0);
  });
});

describeDb("fill history is per-viewer and paged (G11)", () => {
  /**
   * `GET /fills` used to return raw `fills` rows: no side, no market, no bound.
   *
   * The rows are inserted directly rather than traded into existence. What is
   * under test is one query's projection and its cursor — driving real fills
   * through the engine would make this a test of the matching loop, and would
   * make the timestamps unrepeatable, which is exactly what the pagination
   * assertion needs to control.
   */
  const suffix11 = `${Date.now()}-g11`;
  let maker = "";
  let taker = "";
  let makerOrderId = "";
  let takerOrderId = "";
  let ethOrderId = "";
  const insertedFills: string[] = [];
  const insertedOrders: string[] = [];

  /** Deliberately identical timestamps: one sweep writes fills at one instant. */
  const SWEPT_AT = new Date("2026-08-30T09:00:00.000Z");

  beforeAll(async () => {
    const [m, t] = await db
      .insert(users)
      .values([
        { username: `g11-maker-${suffix11}`, passwordHash: "x", name: "Maker" },
        { username: `g11-taker-${suffix11}`, passwordHash: "x", name: "Taker" },
      ])
      .returning();
    maker = m!.id;
    taker = t!.id;

    const order = (
      userId: string,
      positionType: "LONG" | "SHORT",
      marketId: string,
    ) => ({
      userId,
      marketId,
      positionType,
      orderType: "limit" as const,
      status: "filled" as const,
      qty: "3",
      filledQty: "3",
      price: "95",
      slippage: 0,
      initialMargin: "285",
    });

    const created = await db
      .insert(orders)
      .values([
        // The maker is SHORT and the taker is LONG — the row below is the same
        // trade seen from both ends.
        order(maker, "SHORT", MARKETS.SOL.id),
        order(taker, "LONG", MARKETS.SOL.id),
        order(maker, "LONG", MARKETS.ETH.id),
      ])
      .returning();
    makerOrderId = created[0]!.id;
    takerOrderId = created[1]!.id;
    ethOrderId = created[2]!.id;
    insertedOrders.push(...created.map((o) => o.id));

    const createdFills = await db
      .insert(fills)
      .values([
        // Three SOL fills sharing one timestamp, plus one older ETH fill.
        ...[1, 2, 3].map((qty) => ({
          makerId: maker,
          takerId: taker,
          marketId: MARKETS.SOL.id,
          qty: String(qty),
          price: "95",
          makerOrderId,
          takerOrderId,
          createdAt: SWEPT_AT,
        })),
        {
          makerId: maker,
          takerId: taker,
          marketId: MARKETS.ETH.id,
          qty: "1",
          price: "1900",
          makerOrderId: ethOrderId,
          takerOrderId,
          createdAt: new Date("2026-08-30T08:00:00.000Z"),
        },
      ])
      .returning();
    insertedFills.push(...createdFills.map((f) => f.id));
  });

  afterAll(async () => {
    for (const id of insertedFills) await db.delete(fills).where(eq(fills.id, id));
    for (const id of insertedOrders) await db.delete(orders).where(eq(orders.id, id));
    for (const id of [maker, taker]) {
      if (id) await db.delete(users).where(eq(users.id, id));
    }
  });

  it("reports the maker's own side, role and market", async () => {
    const { fills: mine } = await service.getFills(maker, {
      marketId: MARKETS.SOL.id,
    });

    expect(mine).toHaveLength(3);
    for (const fill of mine) {
      expect(fill.side).toBe("SHORT");
      expect(fill.role).toBe("maker");
      expect(fill.marketSlug).toBe("SOL-USD");
      expect(fill.orderId).toBe(makerOrderId);
    }
  });

  it("reports the OPPOSITE side to the counterparty on the same rows", async () => {
    // The assertion that matters: side is a property of the viewer, not the row.
    const { fills: mine } = await service.getFills(maker, {
      marketId: MARKETS.SOL.id,
    });
    const { fills: theirs } = await service.getFills(taker, {
      marketId: MARKETS.SOL.id,
    });

    expect(theirs.map((f) => f.id).sort()).toEqual(mine.map((f) => f.id).sort());
    for (const fill of theirs) {
      expect(fill.side).toBe("LONG");
      expect(fill.role).toBe("taker");
      expect(fill.orderId).toBe(takerOrderId);
    }
  });

  it("filters by market", async () => {
    const { fills: eth } = await service.getFills(maker, {
      marketId: MARKETS.ETH.id,
    });
    expect(eth).toHaveLength(1);
    expect(eth[0]!.marketSlug).toBe("ETH-USD");
    // The ETH order was the maker's LONG — a different side in a different
    // market, from the same account.
    expect(eth[0]!.side).toBe("LONG");
  });

  it("caps the row count at `limit` and offers a cursor", async () => {
    const page = await service.getFills(maker, {
      marketId: MARKETS.SOL.id,
      limit: 2,
    });
    expect(page.fills).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it("pages backwards with no gaps and no repeats", async () => {
    // All four fills, two at a time. Three of them share a timestamp, which is
    // the case a createdAt-only cursor gets wrong in both directions.
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 5; page++) {
      const result = await service.getFills(maker, {
        limit: 2,
        ...(cursor ? { before: cursor } : {}),
      });
      seen.push(...result.fills.map((f) => f.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    expect(cursor).toBeNull();
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(seen.sort()).toEqual([...insertedFills].sort());
  });

  it("returns no cursor when the last page is exactly full", async () => {
    // `limit + 1` rows are read precisely so this is a fact, not a guess: a
    // cursor here would give the UI a Load more button that fetches nothing.
    const result = await service.getFills(maker, { limit: 4 });
    expect(result.fills).toHaveLength(4);
    expect(result.nextCursor).toBeNull();
  });

  it("refuses a malformed cursor rather than silently serving page one", async () => {
    const err = await service
      .getFills(maker, { before: "nonsense" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
  });

  it("shows an account nothing but its own fills", async () => {
    const [stranger] = await db
      .insert(users)
      .values({
        username: `g11-stranger-${suffix11}`,
        passwordHash: "x",
        name: "Stranger",
      })
      .returning();

    const { fills: none } = await service.getFills(stranger!.id);
    expect(none).toEqual([]);

    await db.delete(users).where(eq(users.id, stranger!.id));
  });
});
