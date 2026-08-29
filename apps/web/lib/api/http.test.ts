import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { apiRequest, setAuthTokenGetter } from "./http";
import { ApiError } from "./errors";
import { BalancesSchema, Money } from "./schemas";

/**
 * The transport and the error normaliser.
 *
 * `fetch` is replaced rather than a server started: what is under test is how
 * this layer interprets responses, and the three server error shapes are
 * written out literally so the test doubles as documentation of §3.4.
 */

const realFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const Passthrough = z.object({ ok: z.boolean() });

afterEach(() => {
  globalThis.fetch = realFetch;
  setAuthTokenGetter(() => null);
});

describe("success path", () => {
  it("parses a valid response against its schema", async () => {
    mockFetch(() => jsonResponse(200, { ok: true }));
    expect(await apiRequest("/x", { schema: Passthrough })).toEqual({
      ok: true,
    });
  });

  it("sends JSON and sets content-type only when there is a body", async () => {
    let seen: RequestInit = {};
    mockFetch((_url, init) => {
      seen = init;
      return jsonResponse(200, { ok: true });
    });

    await apiRequest("/x", { schema: Passthrough });
    expect(
      (seen.headers as Record<string, string>)["content-type"],
    ).toBeUndefined();

    await apiRequest("/x", {
      method: "POST",
      body: { a: 1 },
      schema: Passthrough,
    });
    expect((seen.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(seen.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("accepts an empty 204 body when the schema allows it", async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(
      apiRequest("/x", { schema: z.undefined() }),
    ).resolves.toBeUndefined();
  });
});

describe("authorization", () => {
  /**
   * The transport used to attach a bearer token from a getter. The browser now
   * has no token to attach: the backend sets an httpOnly cookie on its own host
   * and the browser sends it automatically. The getter survives for
   * server-side callers, which have no cookie jar.
   */
  it("attaches nothing in the browser even when a token getter is set", async () => {
    setAuthTokenGetter(() => "tok-123");
    let seen: Record<string, string> = {};
    mockFetch((_url, init) => {
      seen = init.headers as Record<string, string>;
      return jsonResponse(200, { ok: true });
    });

    await apiRequest("/x", { schema: Passthrough });
    // If this ever starts passing a token, the token has become reachable from
    // page JavaScript and branch B has been undone.
    expect(seen.authorization).toBeUndefined();
  });

  it("omits it entirely on a public route", async () => {
    setAuthTokenGetter(() => "tok-123");
    let seen: Record<string, string> = {};
    mockFetch((_url, init) => {
      seen = init.headers as Record<string, string>;
      return jsonResponse(200, { ok: true });
    });

    await apiRequest("/markets", { schema: Passthrough, auth: false });
    expect(seen.authorization).toBeUndefined();
  });

  it("sends no header when there is no session", async () => {
    let seen: Record<string, string> = {};
    mockFetch((_url, init) => {
      seen = init.headers as Record<string, string>;
      return jsonResponse(200, { ok: true });
    });

    await apiRequest("/x", { schema: Passthrough });
    expect(seen.authorization).toBeUndefined();
  });
});

describe("error normalisation (§3.4)", () => {
  it("maps an AppError body", async () => {
    mockFetch(() =>
      jsonResponse(400, {
        code: "INVALID_REQUEST",
        message: "User does not have available margin",
      }),
    );

    const err = (await apiRequest("/order", {
      schema: Passthrough,
    }).catch((e) => e)) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("INVALID_REQUEST");
    // The engine's own wording is good enough to show a user; do not paraphrase.
    expect(err.message).toBe("User does not have available margin");
  });

  it("maps a zod rejection into per-field messages", async () => {
    mockFetch(() =>
      jsonResponse(400, {
        error: "Invalid body",
        details: [
          { field: "qty", message: "Too small: expected number to be >0" },
          { field: "price", message: "Invalid input" },
        ],
      }),
    );

    const err = (await apiRequest("/order", {
      schema: Passthrough,
    }).catch((e) => e)) as ApiError;

    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.fieldErrors).toEqual({
      qty: "Too small: expected number to be >0",
      price: "Invalid input",
    });
  });

  it("keeps only the first message per field", async () => {
    mockFetch(() =>
      jsonResponse(400, {
        error: "Invalid body",
        details: [
          { field: "qty", message: "first" },
          { field: "qty", message: "second" },
        ],
      }),
    );

    const err = (await apiRequest("/order", {
      schema: Passthrough,
    }).catch((e) => e)) as ApiError;

    // One input shows one error, not a stack of three.
    expect(err.fieldErrors).toEqual({ qty: "first" });
  });

  it("maps a body-less failure", async () => {
    mockFetch(() => new Response("<html>502</html>", { status: 502 }));

    const err = (await apiRequest("/x", {
      schema: Passthrough,
    }).catch((e) => e)) as ApiError;

    expect(err.code).toBe("UNKNOWN");
    expect(err.status).toBe(502);
    expect(err.isRetryable).toBe(true);
  });

  it("maps a network failure with no status at all", async () => {
    globalThis.fetch = (() =>
      Promise.reject(
        new TypeError("Failed to fetch"),
      )) as unknown as typeof fetch;

    const err = (await apiRequest("/x", {
      schema: Passthrough,
    }).catch((e) => e)) as ApiError;

    expect(err.code).toBe("NETWORK");
    expect(err.status).toBe(0);
    expect(err.isRetryable).toBe(true);
  });

  it("reports a timeout distinctly from a dead network", async () => {
    globalThis.fetch = ((_input: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      })) as typeof fetch;

    const err = (await apiRequest("/x", {
      schema: Passthrough,
      timeoutMs: 10,
    }).catch((e) => e)) as ApiError;

    expect(err.code).toBe("TIMEOUT");
    expect(err.isRetryable).toBe(true);
  });

  it("flags a 2xx of the wrong shape as SCHEMA and names the route", async () => {
    mockFetch(() => jsonResponse(200, { unexpected: true }));

    const err = (await apiRequest("/equity/balances", {
      schema: BalancesSchema,
    }).catch((e) => e)) as ApiError;

    // Not a user-facing condition: the contract has drifted.
    expect(err.code).toBe("SCHEMA");
    expect(err.message).toContain("/equity/balances");
    expect(err.isRetryable).toBe(false);
  });

  it("recognises every auth failure code", async () => {
    for (const code of ["TOKEN_MISSING", "TOKEN_EXPIRED", "TOKEN_INVALID"]) {
      mockFetch(() => jsonResponse(401, { code, message: "nope" }));
      const err = (await apiRequest("/x", {
        schema: Passthrough,
      }).catch((e) => e)) as ApiError;
      expect(err.isAuthFailure).toBe(true);
    }
  });

  it("treats an engine timeout as retryable", async () => {
    mockFetch(() =>
      jsonResponse(503, {
        code: "ENGINE_TIMEOUT",
        message: "The matching engine is not responding",
      }),
    );

    const err = (await apiRequest("/x", {
      schema: Passthrough,
    }).catch((e) => e)) as ApiError;

    expect(err.isRetryable).toBe(true);
    expect(err.isAuthFailure).toBe(false);
  });
});

describe("the money boundary (§7.7)", () => {
  it("turns engine numbers into strings", async () => {
    // The engine replies with JavaScript numbers; the money rule in CLAUDE.md
    // says nothing above this layer may see one.
    mockFetch(() =>
      jsonResponse(200, { balances: { available: 100, locked: 0 } }),
    );

    const result = await apiRequest("/equity/balances", {
      schema: BalancesSchema,
    });

    expect(result.balances).toEqual({ available: "100", locked: "0" });
    expect(typeof result.balances.available).toBe("string");
  });

  it("leaves Postgres strings exactly as they are", async () => {
    // Trailing zeros are significant to a trader reading a size column.
    mockFetch(() =>
      jsonResponse(200, {
        balances: { available: "1958.10", locked: "562.90" },
      }),
    );

    const result = await apiRequest("/equity/balances", {
      schema: BalancesSchema,
    });

    expect(result.balances.available).toBe("1958.10");
  });

  it("accepts either wire type for the same field", () => {
    expect(Money.parse("0.5")).toBe("0.5");
    expect(Money.parse(0.5)).toBe("0.5");
  });
});
