import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import db, { eq } from "@repo/db";
import { orders, users } from "@repo/db/schema";
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

const engineStub = ((type: string, payload: Record<string, unknown>) => {
  calls.push({ type, payload });
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
