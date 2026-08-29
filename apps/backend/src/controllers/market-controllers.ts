import type { Request, Response } from "express";
import type { TService } from "../services";

export const createMarketController = (services: TService) => {
  const getMarkets = async (_req: Request, res: Response) => {
    const markets = await services.getMarkets();
    return res.status(200).json({ markets });
  };

  return { getMarkets };
};
