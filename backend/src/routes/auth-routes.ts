import { Router } from "express";
import { validate } from "../middlewares/validate";
import { CreateUserSchema } from "../types/auth-types";
import type { TController } from "../controllers";

export const createAuthRouter = ({ signup, signin }: TController) => {
  const authRouter = Router();

  authRouter.post("/signup", validate("body", CreateUserSchema), signup);
  authRouter.post(
    "/signin",
    validate("body", CreateUserSchema.omit({ name: true })),
    signin,
  );

  return authRouter;
};
