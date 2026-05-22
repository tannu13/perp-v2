import { Router } from "express";
import { validate } from "../middlewares/validate";
import { CreateUserSchema } from "../types/auth-types";
import type { TController } from "../controllers";
import { OnRampSchema } from "../types/order-types";
import { authenticate } from "../middlewares/authenticate";

export const createOrderRouter = (controller: TController) => {
  const authRouter = Router();

  authRouter.post(
    "/onramp",
    validate("body", OnRampSchema),
    authenticate,
    controller.onramp,
  );

  return authRouter;
};
