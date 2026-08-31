import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "node:http";
import * as jwt from "jsonwebtoken";
import type { TEngineResponseSchema } from "@repo/shared/redis-events";
import { MarketListSchema } from "@repo/shared";
import { MARKETS, MARKET_LIST } from "@repo/db/markets";
import { createApp } from "./server";
import env from "./env";
import { ServiceUnavailableError } from "./errors/custom-errors";

/**
 * HTTP-level cover for Phases 1 and 2.
 *
 * The engine is stubbed, so nothing here needs Redis or a running engine —
 * which is only possible because `createApp` now takes its transport as an
 * argument instead of opening Redis at module scope. `GET /markets` does read
 * Postgres; it is the one case below that needs a seeded database.
 */

type EngineCall = { type: string; payload: Record<string, unknown> };

let calls: EngineCall[] = [];
let nextReply: (call: EngineCall) => Promise<TEngineResponseSchema>;

const engineStub = ((type: string, payload: Record<string, unknown>) => {
  const call = { type, payload };
  calls.push(call);
  return nextReply(call);
}) as never;

const ok = (backend: Record<string, unknown>): TEngineResponseSchema => ({
  correlationId: "test",
  ok: true,
  data: {
    backend,
    // Deliberately present: these are the internal fields that used to be
    // handed to the client verbatim.
    writer: [{ table: "order_updates", data: [] }],
    wsServer: {
      depth: {
        market: "e3289213-372c-44d2-8cc8-2a6eb55b11b1",
        lastUpdateId: 1,
        timestamp: 0,
        bids: [],
        asks: [],
      },
      lastTradedPrice: "90",
      indexPrice: "85",
    },
  },
  error: "",
});

let server: Server;
let base: string;

const request = (path: string, init?: RequestInit) =>
  fetch(`${base}${path}`, init);

/** `Response.json()` is `unknown` under this tsconfig; these are our own fixtures. */
const json = async (res: Response) =>
  (await res.json()) as Record<string, unknown>;

const token = (payload: object, options?: jwt.SignOptions) =>
  jwt.sign(payload, env.JWT_SECRET, options);

const validToken = () =>
  token({ userId: "11111111-1111-1111-1111-111111111111" });

beforeAll(async () => {
  const app = createApp({ sendToEngine: engineStub });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve()) as Server;
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

describe("CORS (G1)", () => {
  it("answers a preflight from an allowed origin", async () => {
    const res = await request("/order", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3020",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });

    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3020",
    );
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(
      res.headers.get("access-control-allow-headers")?.toLowerCase(),
    ).toContain("authorization");
    expect(res.headers.get("access-control-allow-methods")).toContain("DELETE");
  });

  it("does not authorise an origin outside the allowlist", async () => {
    const res = await request("/order", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
      },
    });

    // The browser is what blocks the call; the server's job is simply never to
    // vouch for an origin it does not know.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves a request with no Origin at all — curl, or the Next.js proxy", async () => {
    nextReply = async () => ok({ balances: { available: 10, locked: 0 } });
    const res = await request("/equity/balances", {
      headers: { authorization: `Bearer ${validToken()}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("an unhandled failure (Phase 15)", () => {
  /**
   * Found by stopping Postgres with a browser open: Drizzle puts the failing
   * statement AND its parameters in `error.message`, and the handler was
   * sending that message to the client. `GET /me` answered with the users
   * query and the id it ran with.
   */
  it("keeps an unhandled error's own words off the wire", async () => {
    nextReply = async () => {
      throw new Error(
        'Failed query: select "id" from "users" where id = $1\nparams: 11111111-1111-1111-1111-111111111111',
      );
    };

    const res = await request("/equity/balances", {
      headers: { authorization: `Bearer ${validToken()}` },
    });

    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body).toEqual({
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong on our end.",
    });
    expect(JSON.stringify(body)).not.toContain("Failed query");
    expect(JSON.stringify(body)).not.toContain("11111111");
  });

  it("still answers an operational error in its own words (§7.4)", async () => {
    // The engine's rejections are user-facing copy and must survive.
    nextReply = async () => {
      throw new ServiceUnavailableError(
        "The matching engine is not responding",
        "ENGINE_TIMEOUT",
      );
    };

    const res = await request("/equity/balances", {
      headers: { authorization: `Bearer ${validToken()}` },
    });

    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({
      code: "ENGINE_TIMEOUT",
      message: "The matching engine is not responding",
    });
  });
});

describe("authentication (G6)", () => {
  it("returns 401 TOKEN_MISSING when there is no header", async () => {
    const res = await request("/equity/balances");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "TOKEN_MISSING",
      message: "Missing token",
    });
  });

  it("returns 401 TOKEN_MISSING when the scheme is not Bearer", async () => {
    const res = await request("/equity/balances", {
      headers: { authorization: `Basic ${validToken()}` },
    });
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("TOKEN_MISSING");
  });

  it("returns 401 TOKEN_EXPIRED for a token we issued that has lapsed", async () => {
    // This is the case that used to return 500 { message: "jwt expired" } — and
    // with seven-day tokens, it reaches real users.
    const expired = token(
      { userId: "11111111-1111-1111-1111-111111111111" },
      { expiresIn: "-1s" },
    );
    const res = await request("/equity/balances", {
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "TOKEN_EXPIRED",
      message: "Session expired",
    });
  });

  it("returns 401 TOKEN_INVALID for a malformed token", async () => {
    const res = await request("/equity/balances", {
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("TOKEN_INVALID");
  });

  it("returns 401 TOKEN_INVALID for a token signed with the wrong secret", async () => {
    const forged = jwt.sign(
      { userId: "someone" },
      "a-different-secret-entirely",
    );
    const res = await request("/equity/balances", {
      headers: { authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("TOKEN_INVALID");
  });

  it("never reaches the engine on an auth failure", async () => {
    calls = [];
    await request("/equity/balances", {
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses a WebSocket ticket as a session credential", async () => {
    // Both are signed with `JWT_SECRET` and both name the same user, so
    // without the `typ` check a ticket would be a bearer token for the whole
    // API. It is minted to be put in a URL — where it lands in proxy logs and
    // browser history — and the only thing that makes that acceptable is that
    // it opens exactly one door.
    const ticket = token(
      { userId: "11111111-1111-1111-1111-111111111111", typ: "ws" },
      { expiresIn: 60 },
    );
    const res = await request("/equity/balances", {
      headers: { authorization: `Bearer ${ticket}` },
    });
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("TOKEN_INVALID");
  });
});

/**
 * The WebSocket credential (Phase 13).
 *
 * ws-server cannot read the session cookie — it is host-only on the API host —
 * and a browser's WebSocket handshake carries no custom headers. So the
 * credential has to travel in the URL, and this route exists to make sure the
 * thing that travels there is not the session token.
 */
describe("POST /auth/ws-ticket", () => {
  it("requires a session", async () => {
    const res = await request("/ws-ticket", { method: "POST" });
    expect(res.status).toBe(401);
    expect((await json(res)).code).toBe("TOKEN_MISSING");
  });

  it("mints a short-lived, single-purpose ticket for the caller", async () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    const res = await request("/ws-ticket", {
      method: "POST",
      headers: { authorization: `Bearer ${token({ userId })}` },
    });
    expect(res.status).toBe(200);

    const body = (await json(res)) as { ticket: string; expiresIn: number };
    const decoded = jwt.verify(body.ticket, env.JWT_SECRET) as {
      userId: string;
      typ: string;
      exp: number;
      iat: number;
    };

    expect(decoded.userId).toBe(userId);
    expect(decoded.typ).toBe("ws");
    // Sixty seconds: long enough for a slow handshake, short enough that a log
    // scraped an hour later holds nothing usable.
    expect(decoded.exp - decoded.iat).toBe(60);
    expect(body.expiresIn).toBe(60);
  });

  it("never returns the session token itself", async () => {
    // The reason the whole endpoint exists. A session token in a response body
    // is a session token in browser JavaScript, and this one lasts seven days
    // with no revocation.
    const userId = "11111111-1111-1111-1111-111111111111";
    const session = token({ userId });
    const res = await request("/ws-ticket", {
      method: "POST",
      headers: { authorization: `Bearer ${session}` },
    });
    expect(await res.text()).not.toContain(session);
  });

  it("does not reach the engine", async () => {
    calls = [];
    await request("/ws-ticket", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token({ userId: "11111111-1111-1111-1111-111111111111" })}`,
      },
    });
    expect(calls).toHaveLength(0);
  });
});

describe("response envelope (G7)", () => {
  it("returns only the client-facing payload, not writer or wsServer", async () => {
    nextReply = async () =>
      ok({ balances: { available: 1958.1, locked: 562.9 } });

    const res = await request("/equity/balances", {
      headers: { authorization: `Bearer ${validToken()}` },
    });

    const body = await json(res);
    expect(body).toEqual({ balances: { available: 1958.1, locked: 562.9 } });
    // `writer` carries every fill row bound for Postgres, counterparty user ids
    // included; `wsServer` carries a full depth snapshot. Neither is the
    // caller's business.
    expect(body).not.toHaveProperty("writer");
    expect(body).not.toHaveProperty("wsServer");
    expect(body).not.toHaveProperty("backend");
  });
});

describe("engine failures (G4)", () => {
  it("maps an engine timeout to 503 ENGINE_TIMEOUT", async () => {
    nextReply = async () => {
      throw new ServiceUnavailableError(
        "The matching engine is not responding",
        "ENGINE_TIMEOUT",
      );
    };

    const res = await request("/equity/balances", {
      headers: { authorization: `Bearer ${validToken()}` },
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: "ENGINE_TIMEOUT",
      message: "The matching engine is not responding",
    });
  });

  it("maps an engine rejection to 400 with the engine's own message", async () => {
    nextReply = async () => ({
      correlationId: "test",
      ok: false,
      data: "",
      error: "User does not have available margin",
    });

    const res = await request("/equity/balances", {
      headers: { authorization: `Bearer ${validToken()}` },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "INVALID_REQUEST",
      message: "User does not have available margin",
    });
  });
});

describe("validation", () => {
  it("still rejects a malformed order body with field-level detail", async () => {
    const res = await request("/order", {
      method: "POST",
      headers: {
        authorization: `Bearer ${validToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ orderType: "limit" }),
    });

    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("Invalid body");
    expect(Array.isArray(body.details)).toBe(true);
  });
});

describe("public market data (Phase 2)", () => {
  it("serves GET /markets with no Authorization header", async () => {
    const res = await request("/markets");
    expect(res.status).toBe(200);

    const body = await json(res);
    expect(MarketListSchema.safeParse(body).success).toBe(true);
    expect((body.markets as unknown[]).length).toBe(MARKET_LIST.length);
  });

  it("serves GET /depth with no Authorization header", async () => {
    nextReply = async () =>
      ok({
        market: MARKETS.SOL.id,
        lastUpdateId: 41,
        timestamp: 1756,
        bids: [["95", "1"]],
        asks: [],
      });

    const res = await request(`/depth?marketId=${MARKETS.SOL.id}`);

    // Gated behind a token until Phase 2, which meant a signed-out visitor saw
    // an empty ladder on the first screen of the product.
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.bids).toEqual([["95", "1"]]);
    expect(body).not.toHaveProperty("wsServer");
  });

  it("still validates the depth query", async () => {
    const res = await request("/depth");
    expect(res.status).toBe(400);
  });

  it("keeps the account routes authenticated", async () => {
    // Making depth public must not have loosened anything else on that router.
    for (const path of [
      "/equity/balances",
      "/fills",
      `/orders/open/${MARKETS.SOL.id}`,
      `/positions/open/${MARKETS.SOL.id}`,
    ]) {
      const res = await request(path);
      expect(res.status).toBe(401);
    }
  });
});
