import type { NextFunction, Request, Response } from "express";
import env from "../env";
import { AppError } from "../errors/app-error";

/**
 * CSRF defence, layer two.
 *
 * Layer one is `SameSite=Lax` on the session cookie, which stops a browser
 * attaching it to a cross-site POST at all. This is the belt to that pair of
 * braces, and it earns its place for three reasons:
 *
 *   1. It does not depend on the browser implementing SameSite correctly, or on
 *      it defaulting to Lax — old clients exist.
 *   2. SameSite is about the SITE, so a compromised sibling subdomain
 *      (`evil.example.com`) is same-site and its forged requests carry the
 *      cookie. An explicit origin allowlist rejects those; SameSite alone does
 *      not.
 *   3. It costs one header comparison.
 *
 * Applied to state-changing methods only. A GET must stay usable from a plain
 * navigation, a curl, or a server-to-server call — none of which send `Origin`.
 *
 * A request with NO `Origin` header is allowed through: non-browser clients
 * omit it, and a browser always sends it on cross-origin requests and on any
 * POST. That is the standard trade-off for this check — it is not the thing
 * keeping an attacker out on its own, `SameSite` is.
 */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const verifyOrigin = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (!UNSAFE_METHODS.has(req.method)) return next();

  const origin = req.header("origin");
  if (!origin) return next();

  if (env.CORS_ORIGINS.includes(origin)) return next();

  return next(
    new AppError("Request origin is not allowed.", 403, "ORIGIN_NOT_ALLOWED"),
  );
};
