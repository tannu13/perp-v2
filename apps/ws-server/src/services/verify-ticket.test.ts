import { describe, expect, it } from "bun:test";
import * as jwt from "jsonwebtoken";
import { userTopic, verifyTicket } from "./verify-ticket";

/**
 * The one authentication decision this process makes.
 *
 * Everything else on this socket is public by construction, so this function
 * is the whole boundary between "anyone may read the book" and "only this
 * account may read its own fills". The assertions are therefore mostly about
 * what it REFUSES.
 */

const SECRET = process.env.JWT_SECRET!;

const ticket = (payload: object, options: jwt.SignOptions = { expiresIn: 60 }) =>
  jwt.sign(payload, SECRET, options);

describe("verifyTicket", () => {
  it("accepts a ticket the backend would mint", () => {
    const result = verifyTicket(ticket({ userId: "u-1", typ: "ws" }));
    expect(result).toEqual({ ok: true, userId: "u-1" });
  });

  it("REFUSES a session token, even though it is correctly signed", () => {
    // The whole point of `typ`. A session token lasts seven days and is a full
    // account credential; a ticket is safe to put in a URL precisely because it
    // is not one. Without this check, pasting the cookie's value into
    // `?ticket=` would open the private channel — and leave a week-long bearer
    // token in every proxy log between here and the browser.
    const session = jwt.sign({ userId: "u-1" }, SECRET, { expiresIn: "7d" });
    expect(verifyTicket(session)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a ticket signed with a different secret", () => {
    const forged = jwt.sign({ userId: "u-1", typ: "ws" }, `${SECRET}-not`, {
      expiresIn: 60,
    });
    expect(verifyTicket(forged)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses an expired ticket, and says so", () => {
    // Distinguished from `invalid` because the client's response differs: an
    // expired ticket means fetch another and retry, an invalid one means the
    // session is gone.
    const stale = ticket({ userId: "u-1", typ: "ws" }, { expiresIn: -1 });
    expect(verifyTicket(stale)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a ticket with no user id, and one with a non-string id", () => {
    expect(verifyTicket(ticket({ typ: "ws" })).ok).toBe(false);
    expect(verifyTicket(ticket({ typ: "ws", userId: "" })).ok).toBe(false);
    expect(verifyTicket(ticket({ typ: "ws", userId: 7 })).ok).toBe(false);
  });

  it("refuses garbage without throwing", () => {
    // Reachable from any browser on the internet — an exception here would be
    // an unhandled rejection in the upgrade path.
    expect(verifyTicket("not-a-jwt")).toEqual({ ok: false, reason: "invalid" });
    expect(verifyTicket("")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("userTopic", () => {
  it("namespaces the private topic away from every public one", () => {
    // Public topics are `feed:{marketId}:{feed}`. A user id can never collide
    // with one, which is what keeps a subscription mistake from being a
    // disclosure rather than a bug.
    expect(userTopic("u-1")).toBe("user:u-1");
    expect(userTopic("u-1").startsWith("feed:")).toBe(false);
  });
});
