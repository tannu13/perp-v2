import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server } from "node:http";
import type { TEngineResponseSchema } from "@repo/shared/redis-events";
import { createApp } from "./server";
import { SESSION_COOKIE } from "./utils/session-cookie";

/**
 * The cookie session and its CSRF defences.
 *
 * The browser talks to this service directly — there is no proxy — so these
 * assert the three things that make that safe: the token never appears in a
 * body, the cookie is httpOnly/SameSite, and a cross-site POST is refused.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;

const engineStub = (() =>
  Promise.resolve({
    correlationId: "t",
    ok: true,
    data: { backend: { balances: { available: 0, locked: 0 } } },
    error: "",
  } as TEngineResponseSchema)) as never;

let server: Server;
let base: string;

const request = (path: string, init?: RequestInit) =>
  fetch(`${base}${path}`, init);

beforeAll(async () => {
  const app = createApp({ sendToEngine: engineStub });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve()) as Server;
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => server?.close());

const username = () =>
  `cookie-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describeDb("session cookie", () => {
  it("sets an httpOnly, SameSite cookie and returns NO token", async () => {
    const res = await request("/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: username(),
        password: "pw123456",
        name: "Cookie",
      }),
    });

    expect(res.status).toBe(201);

    const body = (await res.json()) as Record<string, unknown>;
    // The whole point: a token in a body is a token in page JavaScript.
    expect(body).not.toHaveProperty("token");
    expect(body.userId).toBeTruthy();

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie.toLowerCase()).toContain("path=/");
    // Host-only: no Domain attribute, so no sibling subdomain ever sees it.
    expect(setCookie.toLowerCase()).not.toContain("domain=");
  });

  it("authenticates a later request from the cookie alone", async () => {
    const signup = await request("/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: username(),
        password: "pw123456",
        name: "Cookie",
      }),
    });
    const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;

    const me = await request("/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as Record<string, unknown>).userId).toBeTruthy();

    // No cookie, no session.
    const anon = await request("/me");
    expect(anon.status).toBe(401);
  });

  it("clears the cookie on signout", async () => {
    const res = await request("/signout", {
      method: "POST",
      headers: { origin: "http://localhost:3020" },
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    // Max-Age=0 is what removes it; the attributes must still match.
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("cross-origin response policy", () => {
  it("declares itself readable cross-origin", async () => {
    const res = await request("/markets", {
      headers: { origin: "http://localhost:3020" },
    });

    /**
     * helmet defaults CORP to `same-origin`, which silently breaks a browser
     * calling this API from another origin: every CORS header can be correct
     * and the browser still discards the response, reporting it as a CORS
     * failure. It only surfaced once the frontend stopped going through a
     * same-origin proxy.
     */
    expect(res.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin",
    );
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3020",
    );
  });

  it("keeps CORS headers on a rejected request too", async () => {
    // A 400 the browser cannot read is a 400 the user cannot be told about.
    const res = await request("/signin", {
      method: "POST",
      headers: {
        origin: "http://localhost:3020",
        "content-type": "application/json",
      },
      body: JSON.stringify({ username: "nope", password: "nope" }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3020",
    );
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});

describe("CSRF (origin allowlist)", () => {
  it("refuses a state-changing request from an unlisted origin", async () => {
    const res = await request("/signout", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as Record<string, unknown>).code).toBe(
      "ORIGIN_NOT_ALLOWED",
    );
  });

  it("refuses one from a sibling subdomain too", async () => {
    // SameSite alone would NOT stop this: a sibling subdomain is same-site.
    const res = await request("/signout", {
      method: "POST",
      headers: { origin: "https://evil.localhost" },
    });
    expect(res.status).toBe(403);
  });

  it("allows the configured app origin", async () => {
    const res = await request("/signout", {
      method: "POST",
      headers: { origin: "http://localhost:3020" },
    });
    expect(res.status).toBe(200);
  });

  it("leaves GETs alone so curl and navigations still work", async () => {
    const res = await request("/markets", {
      headers: { origin: "https://evil.example.com" },
    });
    // Public market data; the origin check is for state changes only.
    expect(res.status).toBeLessThan(400);
  });

  it("allows a request with no Origin header at all", async () => {
    // Non-browser clients omit it; SameSite is what guards the browser case.
    const res = await request("/signout", { method: "POST" });
    expect(res.status).toBe(200);
  });
});
