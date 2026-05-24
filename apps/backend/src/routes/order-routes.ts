import { Router } from "express";
import { validate } from "../middlewares/validate";
import { CreateUserSchema } from "../types/auth-types";
import type { TController } from "../controllers";
import { OnRampSchema } from "../types/order-types";
import { authenticate } from "../middlewares/authenticate";
import { CreateOrderSchema } from "@repo/shared";
import z from "zod";

export const createOrderRouter = (controller: TController) => {
  const orderRouter = Router();

  orderRouter.post(
    "/onramp",
    authenticate,
    validate("body", OnRampSchema),
    controller.onramp,
  );

  orderRouter.post(
    "/order",
    authenticate,
    validate("body", CreateOrderSchema),
    controller.createOrder,
  );

  orderRouter.delete(
    "/order/:orderId",
    authenticate,
    validate("params", z.object({ orderId: z.string().trim().min(1) })),
    controller.cencelOrder,
  );

  orderRouter.get("/equity/balances", authenticate, controller.getBalances);

  orderRouter.get(
    "/positions/open/:marketId",
    authenticate,
    validate("params", z.object({ marketId: z.string().trim().min(1) })),
    controller.getOpenPositionsForMarket,
  );

  orderRouter.get(
    "/positions/closed/:marketId",
    authenticate,
    validate("params", z.object({ marketId: z.string().trim().min(1) })),
    controller.getClosedPositionsForMarket,
  );

  orderRouter.get(
    "/orders/open/:marketId",
    authenticate,
    validate("params", z.object({ marketId: z.string().trim().min(1) })),
    controller.getOpenOrdersForMarket,
  );

  orderRouter.get(
    "/orders/:marketId",
    authenticate,
    validate("params", z.object({ marketId: z.string().trim().min(1) })),
    controller.getOrdersForMarket,
  );

  orderRouter.get("/fills", authenticate, controller.getFills);

  return orderRouter;
};
