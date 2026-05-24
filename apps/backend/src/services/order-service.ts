import type { TCreateOrderSchema } from "@repo/shared";
import type { TComms } from "./backend-comms";
import db, { eq } from "@repo/db";
import { orders } from "@repo/db/schema";
import { InvalidRequestError, NotFoundError } from "../errors/custom-errors";

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

    return response.data;
  };

  const createOrder = async (userId: string, payload: TCreateOrderSchema) => {
    // td:: create order in db, add order details to payload
    const { market, type, qty, equity, price, orderType, slippage } = payload;
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
    const response = await sendToEngine("create_order", { ...order });
    if (!response.ok) {
      throw new InvalidRequestError(response.error);
    }

    return response.data;
  };

  const cancelOrder = async (orderId: string) => {
    const order = await db.query.orders.findFirst({
      where: (orderRow, { eq }) => eq(orderRow.id, orderId),
    });
    if (!order) {
      throw new NotFoundError("Order does not exist");
    }

    const response = await sendToEngine("cancel_order", { ...order });
    if (!response.ok) {
      throw new InvalidRequestError(response.error);
    }

    return response.data;
  };

  const getBalances = async (userId: string) => {
    const response = await sendToEngine("get_balances", { userId });
    if (!response.ok) {
      throw new InvalidRequestError(response.error);
    }

    return response.data;
  };

  return { onramp, createOrder, cancelOrder, getBalances };
};
