import type { Request, Response } from "express";
import type { TCreateUserSchema } from "../types/auth-types";
import type { TService } from "../services";

export const createAuthController = (services: TService) => {
  const signup = async (req: Request, res: Response) => {
    const { name, username, password } = req.body as TCreateUserSchema;
    const { token, userId } = await services.signup(username, password, name);
    return res.status(201).json({ userId, username, token });
  };

  const signin = async (req: Request, res: Response) => {
    const { username, password } = req.body as Omit<TCreateUserSchema, "name">;
    const { token, userId } = await services.signin(username, password);
    return res.status(200).json({ userId, username, token });
  };

  return { signup, signin };
};
