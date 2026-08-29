import { Router } from "express";
import { validate } from "../middlewares/validate";
import { CreateUserSchema } from "../types/auth-types";
import type { TController } from "../controllers";
import { authenticate } from "../middlewares/authenticate";

export const createAuthRouter = (controller: TController) => {
  const authRouter = Router();

  authRouter.post(
    "/signup",
    validate("body", CreateUserSchema),
    controller.signup,
  );
  authRouter.post(
    "/signin",
    validate("body", CreateUserSchema.omit({ name: true })),
    controller.signin,
  );

  authRouter.post("/signout", controller.signout);

  /**
   * Identity for the current cookie. Authenticated, so an expired session
   * answers 401 and the client's interceptor handles it like any other.
   */
  authRouter.get("/me", authenticate, controller.me);

  return authRouter;
};
