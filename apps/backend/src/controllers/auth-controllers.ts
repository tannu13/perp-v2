import type { Request, Response } from "express";
import type { TCreateUserSchema } from "../types/auth-types";
import type { TService } from "../services";
import { clearSessionCookie, setSessionCookie } from "../utils/session-cookie";
import { createWsTicket, WS_TICKET_TTL_SECONDS } from "../utils/auth";

/**
 * Authentication.
 *
 * The token is written to an httpOnly cookie and **never returned in a response
 * body**. That is the whole point: a token in the body is a token in browser
 * JavaScript, and this one lasts seven days with no refresh and no revocation
 * (`utils/auth.ts`), so anything able to read it owns the account for a week.
 *
 * Callers get identity instead. `GET /me` exists because of this: the client
 * cannot decode a cookie it cannot read, so it has to ask.
 */
export const createAuthController = (services: TService) => {
  const signup = async (req: Request, res: Response) => {
    const { name, username, password } = req.body as TCreateUserSchema;
    const { token, userId } = await services.signup(username, password, name);

    setSessionCookie(res, token);
    return res.status(201).json({ userId, username });
  };

  const signin = async (req: Request, res: Response) => {
    const { username, password } = req.body as Omit<TCreateUserSchema, "name">;
    const { token, userId } = await services.signin(username, password);

    setSessionCookie(res, token);
    return res.status(200).json({ userId, username });
  };

  /**
   * Clears the cookie.
   *
   * This is all a logout can be here: the JWT stays cryptographically valid
   * until it expires because there is no revocation list. Nothing can present
   * it once it is gone from the browser, but that is not the same as a
   * server-side logout and should not be described as one.
   */
  const signout = async (_req: Request, res: Response) => {
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  };

  /**
   * Who the caller is, according to their cookie.
   *
   * Deliberately does not touch the engine — it answers "is this session good,
   * and whose", which is what a client needs on boot to decide between showing
   * the app and showing a sign-in screen.
   */
  const me = async (req: Request, res: Response) => {
    const user = await services.getUserById(req.userId!);
    return res.status(200).json({ userId: user.id, username: user.username });
  };

  /**
   * A ticket for the private WebSocket channel.
   *
   * Authenticated by the session cookie like any other route, and the only
   * thing it hands back is a sixty-second, single-purpose credential — see
   * `createWsTicket`. The session token itself is never returned in a body;
   * this endpoint exists precisely so that it does not have to be.
   *
   * `expiresIn` is returned so the client can decide to re-ticket rather than
   * hardcode a number that would silently drift from the server's.
   */
  const wsTicket = async (req: Request, res: Response) => {
    const ticket = createWsTicket(req.userId!);
    return res.status(200).json({ ticket, expiresIn: WS_TICKET_TTL_SECONDS });
  };

  return { signup, signin, signout, me, wsTicket };
};
