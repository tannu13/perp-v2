import type { TService } from "../services";
import { createAuthController } from "./auth-controllers";
import { createMarketController } from "./market-controllers";
import { createOrderController } from "./order-controllers";

export const createControllers = (services: TService) => {
  const authController = createAuthController(services);
  const orderController = createOrderController(services);
  const marketController = createMarketController(services);
  return {
    ...authController,
    ...orderController,
    ...marketController,
  };
};

export type TController = ReturnType<typeof createControllers>;
