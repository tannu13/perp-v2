import { createAuthService } from "./auth-service";
import type { TComms } from "./backend-comms";
import { createOrderService } from "./order-service";

export const createServices = ({
  sendToEngine,
}: {
  sendToEngine: TComms["sendToEngineStream"];
}) => {
  const authService = createAuthService({ sendToEngine });
  const orderService = createOrderService({ sendToEngine });

  return { ...authService, ...orderService };
};
export type TService = ReturnType<typeof createServices>;
