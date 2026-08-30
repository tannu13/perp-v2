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

  /**
   * A credential for the ws-server upgrade (Phase 13).
   *
   * POST rather than GET despite reading nothing: it mints a credential, and a
   * GET is cacheable, prefetchable and lands in browser history with its
   * response body. The `Origin` allowlist in `verify-origin.ts` also only
   * guards unsafe methods, which is the layer that stops another site from
   * having a logged-in browser fetch a ticket for it.
   */
  authRouter.post("/ws-ticket", authenticate, controller.wsTicket);

  return authRouter;
};
