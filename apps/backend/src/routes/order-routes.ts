import { Router } from "express";
import { validate } from "../middlewares/validate";
import { CreateUserSchema } from "../types/auth-types";
import type { TController } from "../controllers";
import { OnRampSchema } from "../types/order-types";
import { authenticate } from "../middlewares/authenticate";
import { CreateOrderSchema } from "@repo/shared";

export const createOrderRouter = (controller: TController) => {
  const authRouter = Router();

  authRouter.post(
    "/onramp",
    authenticate,
    validate("body", OnRampSchema),
    controller.onramp,
  );

  authRouter.post(
    "/order",
    authenticate,
    validate("body", CreateOrderSchema),
    controller.createOrder,
  );

  return authRouter;
};
