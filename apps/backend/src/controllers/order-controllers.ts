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

  return { onramp, createOrder };
};
