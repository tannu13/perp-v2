import type { Request, Response } from "express";
import type { TCreateUserSchema } from "../types/auth-types";
import type { TService } from "../services";
import type { TOnRampSchema } from "../types/order-types";
import type { TCreateOrderSchema } from "@repo/shared";

export const createOrderController = (services: TService) => {
  const onramp = async (req: Request, res: Response) => {
    const userId = req.userId!;
    const { amount } = req.body as TOnRampSchema;
    const response = await services.onramp(userId, amount);
    return res.status(200).json(response);
  };

  const createOrder = async (req: Request, res: Response) => {
    const userId = req.userId!;
    const payload = req.body as TCreateOrderSchema;
    const response = await services.createOrder(userId, payload);
    return res.status(200).json(response);
  };

  const cencelOrder = async (req: Request, res: Response) => {
    const orderId = req.params.orderId as string;
    const response = await services.cancelOrder(orderId);
    return res.status(200).json(response);
  };

  const getBalances = async (req: Request, res: Response) => {
    const userId = req.userId!;
    const response = await services.getBalances(userId);
    return res.status(200).json(response);
  };

  const getOpenPositionsForMarket = async (req: Request, res: Response) => {
    const userId = req.userId!;
    const marketId = req.params.marketId as string;
    const response = await services.getOpenPositionsForMarket(userId, marketId);
    return res.status(200).json(response);
  };

  const getClosedPositionsForMarket = async (req: Request, res: Response) => {
    const userId = req.userId!;
    const marketId = req.params.marketId as string;
    const response = await services.getClosedPositionsForMarket(
      userId,
      marketId,
    );
    return res.status(200).json(response);
  };

  const getOpenOrdersForMarket = async (req: Request, res: Response) => {
    const userId = req.userId!;
    const marketId = req.params.marketId as string;
    const response = await services.getOpenOrdersForMarket(userId, marketId);
    return res.status(200).json(response);
  };

  const getOrdersForMarket = async (req: Request, res: Response) => {
    const userId = req.userId!;
    const marketId = req.params.marketId as string;
    const response = await services.getOrdersForMarket(userId, marketId);
    return res.status(200).json(response);
  };

  const getFills = async (req: Request, res: Response) => {
    const userId = req.userId!;
    const response = await services.getFills(userId);
    return res.status(200).json(response);
  };

  return {
    onramp,
    createOrder,
    cencelOrder,
    getBalances,
    getOpenPositionsForMarket,
    getClosedPositionsForMarket,
    getOpenOrdersForMarket,
    getOrdersForMarket,
    getFills,
  };
};
