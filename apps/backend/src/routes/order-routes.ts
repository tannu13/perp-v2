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

  return orderRouter;
};
