import { createAuthService } from "./auth-service";
import type { TComms } from "./backend-comms";
import { createMarketService } from "./market-service";
import { createOrderService } from "./order-service";

export const createServices = ({
  sendToEngine,
}: {
  sendToEngine: TComms["sendToEngineStream"];
}) => {
  const authService = createAuthService({ sendToEngine });
  const orderService = createOrderService({ sendToEngine });
  const marketService = createMarketService();

  return { ...authService, ...orderService, ...marketService };
};
export type TService = ReturnType<typeof createServices>;
