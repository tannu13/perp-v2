import { createAuthService } from "./auth-service";
import type { TComms } from "./backend-comms";

export const createServices = ({
  sendToEngine,
}: {
  sendToEngine: TComms["sendToEngineStream"];
}) => {
  const authService = createAuthService({ sendToEngine });

  return { ...authService };
};
export type TService = ReturnType<typeof createServices>;
