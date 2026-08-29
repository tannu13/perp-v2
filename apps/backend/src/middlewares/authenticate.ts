import type { NextFunction, Request, Response } from "express";
import { TokenExpiredError } from "jsonwebtoken";
import { decodeToken } from "../utils/auth";
import { UnauthorizedError } from "../errors/custom-errors";
import { readToken } from "../utils/session-cookie";

/**
 * Bearer-token authentication.
 *
 * `decodeToken` used to be called bare. `jwt.verify` throws synchronously on an
 * expired or malformed token, Express 5 forwards that to the terminal handler,
 * and the handler does not recognise a `TokenExpiredError` as an operational
 * `AppError` — so an ordinary expired session produced
 * `500 { code: "INTERNAL_SERVER_ERROR", message: "jwt expired" }`. Tokens last
 * seven days, so this was guaranteed to reach real users, and the frontend had
 * no way to tell "sign in again" from "the server is broken".
 *
 * The three failures are now distinguishable by code, which is what the
 * frontend's 401 interceptor keys on:
 *   TOKEN_MISSING  no session cookie and no Bearer header
 *   TOKEN_EXPIRED  a token we issued, past its expiry — re-authenticate
 *   TOKEN_INVALID  malformed, wrong signature, or not ours — do not retry
 */
export const authenticate = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const token = readToken(req);

  if (!token) {
    return next(new UnauthorizedError("Missing token", "TOKEN_MISSING"));
  }

  try {
    const { userId } = decodeToken(token);
    req.userId = userId;
    return next();
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      return next(new UnauthorizedError("Session expired", "TOKEN_EXPIRED"));
    }
    return next(new UnauthorizedError("Invalid token", "TOKEN_INVALID"));
  }
};
