import type { CookieOptions, Response } from "express";
import env from "../env";

/**
 * The session cookie.
 *
 * Set by THIS service, on its own host, and read straight back off the request.
 * The browser talks to the API directly — there is no proxy in front of it — so
 * the cookie has to survive a cross-ORIGIN, same-SITE request:
 *
 *   app.example.com  ──fetch(credentials:"include")──▶  api.example.com
 *
 * That works because `SameSite` is about the registrable domain, not the
 * origin: two subdomains of `example.com` are the same site, so a `Lax` cookie
 * is sent on those requests. CORS (`credentials: true` plus an explicit origin
 * allowlist) is what lets the response be read.
 *
 * HOST-ONLY, deliberately. There is no `Domain` attribute, so the cookie is
 * scoped to the API host alone and is never sent to — or settable by — a
 * sibling subdomain. That is what makes the `__Host-` prefix available, and the
 * prefix is worth having: a browser rejects a `__Host-` cookie that lacks
 * `Secure`, lacks `Path=/`, or carries a `Domain`, so a future edit cannot
 * quietly widen its scope.
 *
 * The prefix and `Secure` are production-only because `__Host-` requires
 * `Secure`, and browsers disagree about whether `http://localhost` counts.
 */

const PRODUCTION = env.NODE_ENV === "production";

export const SESSION_COOKIE = PRODUCTION
  ? "__Host-perp_session"
  : "perp_session";

/** Matches the JWT's own `expiresIn: "7d"`. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const baseOptions: CookieOptions = {
  httpOnly: true,
  /**
   * `lax`, not `strict`: the two are identical for our own XHR (same-site
   * either way), but `strict` also drops the cookie on a top-level navigation
   * arriving from anywhere else, which would sign a user out for following a
   * link into the app. `lax` is what blocks cross-site POSTs; the Origin check
   * in `verify-origin.ts` is the second layer.
   */
  sameSite: "lax",
  secure: PRODUCTION,
  path: "/",
};

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions, maxAge: MAX_AGE_MS });
}

export function clearSessionCookie(res: Response) {
  // Same attributes, zero age: a cookie is only replaced when name, path and
  // domain all match the original.
  res.cookie(SESSION_COOKIE, "", { ...baseOptions, maxAge: 0 });
}

/**
 * The bearer token for a request, from the cookie or an Authorization header.
 *
 * Browsers use the cookie. The header is kept for callers that have no cookie
 * jar — curl, the integration tests, another service — and concedes nothing:
 * presenting the header already requires possessing the token.
 */
export function readToken(req: {
  cookies?: Record<string, string | undefined>;
  header(name: string): string | undefined;
}): string | null {
  const fromCookie = req.cookies?.[SESSION_COOKIE];
  if (fromCookie) return fromCookie;

  const authHeader = req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  return null;
}
