import { createAuthService } from "./auth-service";

export const createServices = () => {
  const authService = createAuthService();

  return { ...authService };
};
export type TService = ReturnType<typeof createServices>;
