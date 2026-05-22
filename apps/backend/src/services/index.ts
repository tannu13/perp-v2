import { createAuthService } from "./auth-service";
import type { TComms } from "./backend-comms";
import { createEngineService } from "./engine-service";

export const createServices = ({
  sendToEngine,
}: {
  sendToEngine: TComms["sendToEngineStream"];
}) => {
  const authService = createAuthService({ sendToEngine });
  const engineService = createEngineService({ sendToEngine });

  return { ...authService, ...engineService };
};
export type TService = ReturnType<typeof createServices>;
