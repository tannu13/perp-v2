import type { TService } from "../services";
import { createAuthController } from "./auth-controllers";

export const createControllers = (services: TService) => {
  const { signup, signin } = createAuthController(services);
  return {
    signup,
    signin,
  };
};

export type TController = ReturnType<typeof createControllers>;
