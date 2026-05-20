import type { TController } from "../controllers";
import { createAuthRouter } from "./auth-routes";

export const createRoutes = (controllers: TController) => {
  const authRouter = createAuthRouter(controllers);
  return {
    authRouter,
  };
};
