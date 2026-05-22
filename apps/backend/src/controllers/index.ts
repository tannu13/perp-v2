import type { TService } from "../services";
import { createAuthController } from "./auth-controllers";
import { createOrderController } from "./order-controllers";

export const createControllers = (services: TService) => {
  const authController = createAuthController(services);
  const orderController = createOrderController(services);
  return {
    ...authController,
    ...orderController,
  };
};

export type TController = ReturnType<typeof createControllers>;
