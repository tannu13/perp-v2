import * as jwt from "jsonwebtoken";
import env from "../env";

type TTokenPayload = {
  userId: string;
};
export const createToken = (payload: TTokenPayload) => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

/**
 * Verifies a SESSION token.
 *
 * A WebSocket ticket carries `typ: "ws"` and is rejected here, even though it
 * is signed with the same secret and names the same user. A credential minted
 * to be put in a URL must not also open the REST API: the whole reason the
 * ticket is safe to leak into a proxy log is that sixty seconds later it opens
 * nothing, and accepting it here would make it a bearer token for the account
 * for those sixty seconds.
 */
export const decodeToken = (token: string) => {
  const payload = jwt.verify(token, env.JWT_SECRET) as TTokenPayload & {
    typ?: string;
  };
  if (payload.typ) throw new jwt.JsonWebTokenError("not a session token");
  return payload as TTokenPayload;
};

/**
 * A short-lived credential for the WebSocket upgrade.
 *
 * The session token lives in an httpOnly cookie on the API host (D1, branch
 * C), so browser JavaScript cannot read it — which rules out branch A of
 * §6.14, "send the JWT itself". And a WebSocket handshake from a browser
 * carries no custom headers: the only channels are the cookie (wrong host in
 * production — `ws.example.com` is not `api.example.com`, and the cookie is
 * deliberately host-only) and the URL.
 *
 * So the credential goes in the URL, and everything about this token is shaped
 * by the fact that a URL is the least private place to put one. It leaks into
 * proxy logs, `Referer` headers and browser history:
 *
 *  - **60 seconds.** Long enough to survive a slow handshake, short enough
 *    that a log scraped an hour later holds nothing usable.
 *  - **`typ: "ws"`.** ws-server REQUIRES it, so a seven-day session token
 *    pasted into a `?ticket=` parameter is refused; and the API's own
 *    `authenticate` middleware refuses a ticket, because a ticket is not a
 *    session. The two are mutually non-interchangeable rather than merely
 *    different, which is the property worth having.
 *
 * Signed with the same `JWT_SECRET` — §6.14 says so, and a second secret would
 * be a second thing to rotate for no gain the claim above does not already
 * provide.
 */
export const WS_TICKET_TTL_SECONDS = 60;

type TWsTicketPayload = { userId: string; typ: "ws" };

export const createWsTicket = (userId: string) => {
  return jwt.sign({ userId, typ: "ws" } satisfies TWsTicketPayload, env.JWT_SECRET, {
    expiresIn: WS_TICKET_TTL_SECONDS,
  });
};
