import { Router } from "express";
import type { TController } from "../controllers";

/**
 * Public market data. No `authenticate` anywhere in here on purpose: the market
 * list and the depth ladder are what a signed-out visitor sees, and every
 * exchange serves both anonymously.
 */
export const createMarketRouter = (controller: TController) => {
  const marketRouter = Router();

  marketRouter.get("/markets", controller.getMarkets);

  return marketRouter;
};
