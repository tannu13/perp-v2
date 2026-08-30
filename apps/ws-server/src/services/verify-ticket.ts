import * as jwt from "jsonwebtoken";
import env from "../env";

/**
 * The WebSocket credential, verified.
 *
 * A browser's WebSocket handshake carries no custom headers, and the session
 * cookie is host-only on the API host — so the only way a credential reaches
 * this server is the URL. Everything below is shaped by that: the ticket is
 * minted by the backend with a sixty-second life and a `typ: "ws"` claim
 * (`apps/backend/src/utils/auth.ts`), and both halves are enforced here.
 *
 * **`typ` is not decoration.** Without it, anything signed with `JWT_SECRET`
 * opens the private channel — including the seven-day session token itself. A
 * session token that reached a URL would then be a full account credential
 * sitting in a proxy log for a week. Requiring the claim means the only thing
 * that works here is the thing that was minted to be put in a URL.
 *
 * Returns the user id, or null for anything that does not verify. It never
 * throws: an unparseable ticket is an ordinary event on a public endpoint, and
 * the caller's job is to refuse the upgrade, not to handle an exception.
 */
export type TicketResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "expired" | "invalid" };

export function verifyTicket(ticket: string): TicketResult {
  try {
    const payload = jwt.verify(ticket, env.JWT_SECRET) as {
      userId?: unknown;
      typ?: unknown;
    };

    if (payload.typ !== "ws") return { ok: false, reason: "invalid" };
    if (typeof payload.userId !== "string" || payload.userId.length === 0) {
      return { ok: false, reason: "invalid" };
    }

    return { ok: true, userId: payload.userId };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "invalid" };
  }
}

/** The topic one account's events are published to. */
export const userTopic = (userId: string) => `user:${userId}`;
