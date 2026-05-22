import type { NextFunction, Request, Response } from "express";
import { decodeToken } from "../utils/auth";

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.header("authorization");
  const token =
    authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Missing token" });
  }

  const { userId } = decodeToken(token);
  req.userId = userId;
  next();
};
