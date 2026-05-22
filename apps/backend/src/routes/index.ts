import type { TController } from "../controllers";
import { createAuthRouter } from "./auth-routes";
import { createOrderRouter } from "./order-routes";

export const createRoutes = (controllers: TController) => {
  const authRouter = createAuthRouter(controllers);
  const orderRouter = createOrderRouter(controllers);

  return {
    authRouter,
    orderRouter,
  };
};
