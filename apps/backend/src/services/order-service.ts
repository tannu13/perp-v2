import type { TCreateOrderSchema } from "@repo/shared";
import type { TComms } from "./backend-comms";
import db, { and, eq } from "@repo/db";
import { orders, orderStatusesEnum } from "@repo/db/schema";
import { InvalidRequestError, NotFoundError } from "../errors/custom-errors";
import {
  decodeFillCursor,
  encodeFillCursor,
  fillViewsFor,
} from "./fill-view";

/**
 * Page size for `GET /fills`. The default is what the Fill-history tab asks
 * for implicitly; the max is what a hand-written `?limit=` cannot exceed, so
 * the route cannot be turned back into the unbounded one it used to be.
 */
const DEFAULT_FILLS_LIMIT = 100;
const MAX_FILLS_LIMIT = 500;

export const createOrderService = ({
  sendToEngine,
}: {
  sendToEngine: TComms["sendToEngineStream"];
}) => {
  const onramp = async (userId: string, addBalance: number) => {
    const response = await sendToEngine("onramp", {
      userId,
      amount: addBalance,
    });

    if (!response.ok) {
      throw new InvalidRequestError(response.error);
    }

    return response.data.backend;
  };

  const createOrder = async (userId: string, payload: TCreateOrderSchema) => {
    const { market, type, qty, equity, price, orderType, slippage } = payload;
    // td:: maybe cache the market data here
    const marketRow = await db.query.markets.findFirst({
      columns: {
        id: true,
      },
      where: (marketRow, { eq }) => eq(marketRow.slug, market),
    });
    if (!marketRow) {
      throw new NotFoundError("Market does not exist");
    }

    const order = await db
      .insert(orders)
      .values({
        userId,
        marketId: marketRow.id,
        positionType: type,
        orderType,
        status: "pending",
        qty: qty.toString(),
        filledQty: "0",
        price: price.toString(),
        slippage,
        initialMargin: equity ? equity.toString() : "0",
      })
      .returning()
      .then((res) => res[0]!);

    /**
     * G28 — the row exists before the engine has agreed to it.
     *
     * It has to: the engine keys the order by the id Postgres generates. But
     * that means every refusal — no margin, unsupported leverage, nothing to
     * match — used to leave an immortal `pending` row that `/orders/open` and
     * `/orders` both returned, so a rejected order showed up in the UI as a
     * live one with a Cancel button the engine has never heard of.
     *
     * It is marked `cancelled` rather than deleted: a rejected order is a thing
     * the user did, and the audit trail is worth more than a tidy table. The
     * `pending` predicate makes this a no-op if anything else has already moved
     * the row on.
     */
    let response;
    try {
      response = await sendToEngine("create_order", { ...order });
    } catch (err) {
      // A transport failure (engine timeout) leaves the same orphan behind.
      await settleRejectedOrder(order.id);
      throw err;
    }

    if (!response.ok) {
      await settleRejectedOrder(order.id);
      throw new InvalidRequestError(response.error);
    }

    return response.data.backend;
  };

  /**
   * Retires an order the engine never accepted.
   *
   * Deliberately swallows its own failure: the caller is already on its way to
   * reporting the engine's rejection, and replacing "User does not have
   * available margin" with a database error would hide the real answer.
   */
  const settleRejectedOrder = async (orderId: string) => {
    try {
      await db
        .update(orders)
        .set({ status: "cancelled" })
        .where(and(eq(orders.id, orderId), eq(orders.status, "pending")));
    } catch (err) {
      console.error(
        `Failed to retire rejected order ${orderId}; it may be left pending`,
        err,
      );
    }
  };

  /**
   * Cancels a resting order.
   *
   * The `userId` predicate is the whole point: this used to look the order up
   * by id alone and forward it to the engine, so any authenticated user could
   * cancel any other user's resting order simply by knowing — or guessing — its
   * id. A miss returns 404 rather than 403 on purpose; a 403 would confirm that
   * someone else's order id exists.
   */
  const cancelOrder = async (userId: string, orderId: string) => {
    const order = await db.query.orders.findFirst({
      where: (orderRow, { eq, and }) =>
        and(eq(orderRow.id, orderId), eq(orderRow.userId, userId)),
    });
    if (!order) {
      throw new NotFoundError("Order does not exist");
    }

    const response = await sendToEngine("cancel_order", { ...order });
    if (!response.ok) {
      throw new InvalidRequestError(response.error);
    }

    return response.data.backend;
  };

  const getBalances = async (userId: string) => {
    const response = await sendToEngine("get_balances", { userId });
    if (!response.ok) {
      throw new InvalidRequestError(response.error);
    }

    return response.data.backend;
  };

  const getOpenPositionsForMarket = async (
    userId: string,
    marketId: string,
  ) => {
    const response = await sendToEngine("get_open_positions_for_market", {
      userId,
      marketId,
    });
    if (!response.ok) {
      throw new InvalidRequestError(response.error);
    }

    return response.data.backend;
  };

  const getClosedPositionsForMarket = async (
    userId: string,
    marketId: string,
  ) => {
    const response = await sendToEngine("get_closed_positions_for_market", {
      userId,
      marketId,
    });
    if (!response.ok) {
      throw new InvalidRequestError(response.error);
    }

    return response.data.backend;
  };

  /**
   * The orders that are actually resting on the book (G27).
   *
   * This used to be "every status except cancelled", derived from the enum, which
   * kept `filled` and `pending` as well. `filled` orders would have filled the
   * Open-orders tab with terminal rows, each carrying a Cancel button the engine
   * answers with "Order not found"; `pending` rows are orders the engine has not
   * acknowledged yet, so they are not on the book either and cannot be cancelled.
   *
   * Listed explicitly rather than filtered out of the enum: adding a new status
   * to the schema must not silently enrol it in this query.
   */
  const OPEN_ORDER_STATUSES = ["open", "partially_filled"] as const satisfies
    readonly (typeof orderStatusesEnum.enumValues)[number][];

  const getOpenOrdersForMarket = async (userId: string, marketId: string) => {
    const ordersData = await db.query.orders.findMany({
      where: (orderRecord, { eq, and, inArray }) =>
        and(
          eq(orderRecord.userId, userId),
          eq(orderRecord.marketId, marketId),
          inArray(orderRecord.status, [...OPEN_ORDER_STATUSES]),
        ),
    });

    return { orders: ordersData };
  };

  const getOrdersForMarket = async (userId: string, marketId: string) => {
    const ordersData = await db.query.orders.findMany({
      where: (orderRecord, { eq, and }) =>
        and(eq(orderRecord.userId, userId), eq(orderRecord.marketId, marketId)),
    });

    return { orders: ordersData };
  };

  /**
   * The account's fill history (G11).
   *
   * Two things were wrong with the previous version, and both were about what
   * the caller could do with what came back.
   *
   * **It carried no side.** A `fills` row records a trade, not a participant —
   * maker and taker, no direction. The UI has to print LONG or SHORT for the
   * person looking at it, so the row is rewritten per-viewer in `fill-view.ts`,
   * which joins each side to its own order. Doing it here rather than in the
   * browser is deliberate: the client would need every order it has ever placed
   * in memory to answer the same question.
   *
   * **It was unbounded.** Every fill the account had ever taken part in, in one
   * response, growing forever. `limit` caps it and `before` pages backwards
   * from a cursor that is total-ordered (see `encodeFillCursor`).
   *
   * `limit + 1` rows are read so the presence of a next page is a fact rather
   * than a guess: returning a cursor whenever the page came back full would
   * hand the UI a "Load more" button that fetches nothing.
   */
  const getFills = async (
    userId: string,
    options: { marketId?: string; limit?: number; before?: string } = {},
  ) => {
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_FILLS_LIMIT, 1),
      MAX_FILLS_LIMIT,
    );

    const cursor = options.before ? decodeFillCursor(options.before) : null;
    if (options.before && !cursor) {
      throw new InvalidRequestError("Invalid cursor");
    }

    const rows = await db.query.fills.findMany({
      where: (fillRecord, { eq, or, and, lt }) =>
        and(
          or(eq(fillRecord.makerId, userId), eq(fillRecord.takerId, userId)),
          options.marketId
            ? eq(fillRecord.marketId, options.marketId)
            : undefined,
          /**
           * Strictly `<` on the pair, not on the timestamp: fills written by
           * one sweep share a timestamp, and `lt(createdAt)` alone would drop
           * the rest of that group from the next page.
           */
          cursor
            ? or(
                lt(fillRecord.createdAt, cursor.createdAt),
                and(
                  eq(fillRecord.createdAt, cursor.createdAt),
                  lt(fillRecord.id, cursor.id),
                ),
              )
            : undefined,
        ),
      orderBy: (fillRecord, { desc }) => [
        desc(fillRecord.createdAt),
        desc(fillRecord.id),
      ],
      limit: limit + 1,
      with: {
        market: { columns: { slug: true } },
        makerOrder: { columns: { positionType: true } },
        takerOrder: { columns: { positionType: true } },
      },
    });

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      /**
       * `flatMap`, because a self-trade puts the account on both sides of one
       * fill and both of them are trades it made. The cursor still counts
       * fills, so paging stays consistent even though the row count can exceed
       * `limit` — the alternative is a page boundary that can split a trade.
       */
      fills: page.flatMap((row) => fillViewsFor(row, userId)),
      nextCursor: rows.length > limit && last ? encodeFillCursor(last) : null,
    };
  };

  const getDepth = async (marketId: string) => {
    const response = await sendToEngine("get_depth", {
      marketId,
    });
    if (!response.ok) {
      throw new InvalidRequestError(response.error);
    }

    return response.data.backend;
  };

  return {
    onramp,
    createOrder,
    cancelOrder,
    getBalances,
    getOpenPositionsForMarket,
    getClosedPositionsForMarket,
    getOpenOrdersForMarket,
    getOrdersForMarket,
    getFills,
    getDepth,
  };
};
