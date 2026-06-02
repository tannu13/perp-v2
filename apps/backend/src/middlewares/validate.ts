import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";

export const validate = (
  target: "body" | "query" | "params",
  schema: ZodType,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (target === "query") {
        req.validated = {
          query: schema.parse(req[target]) as Record<string, unknown>,
        };
      } else {
        // for params & body
        req[target] = schema.parse(req[target]);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: `Invalid ${target}`,
          details: error.issues.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        });
      }
      next(error);
    }
  };
};
