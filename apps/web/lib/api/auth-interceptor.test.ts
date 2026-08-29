import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  apiRequest,
  resetAuthFailureLatch,
  setAuthFailureHandler,
} from "./http";

/**
 * The 401 interceptor.
 *
 * The behaviour under test is de-duplication: the terminal refetches five
 * account tables plus balances at once, and an expired session must produce one
 * sign-out, not six racing redirects.
 */

const realFetch = globalThis.fetch;
const Passthrough = z.object({ ok: z.boolean() });

function respond(status: number, body: unknown) {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  setAuthFailureHandler(null);
  resetAuthFailureLatch();
});

describe("auth failure notification", () => {
  it("fires once for a burst of concurrent 401s", async () => {
    respond(401, { code: "TOKEN_EXPIRED", message: "Session expired" });

    let calls = 0;
    setAuthFailureHandler(() => {
      calls += 1;
    });

    // Six tables refetching on one screen.
    await Promise.all(
      Array.from({ length: 6 }, () =>
        apiRequest("/equity/balances", { schema: Passthrough }).catch(
          () => undefined,
        ),
      ),
    );

    expect(calls).toBe(1);
  });

  it("fires again for a genuinely later failure", async () => {
    respond(401, { code: "TOKEN_EXPIRED", message: "Session expired" });

    let calls = 0;
    setAuthFailureHandler(() => {
      calls += 1;
    });

    await apiRequest("/x", { schema: Passthrough }).catch(() => undefined);
    // Let the latch release — a permanent one would swallow the second expiry
    // of a session that was signed back into.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await apiRequest("/x", { schema: Passthrough }).catch(() => undefined);

    expect(calls).toBe(2);
  });

  it("does not fire for a 401 on a public route", async () => {
    respond(401, { code: "TOKEN_MISSING", message: "Missing token" });

    let calls = 0;
    setAuthFailureHandler(() => {
      calls += 1;
    });

    await apiRequest("/markets", {
      schema: Passthrough,
      auth: false,
    }).catch(() => undefined);

    // Bouncing a signed-in user because a public endpoint misbehaved is how
    // redirect loops start.
    expect(calls).toBe(0);
  });

  it("does not fire for non-auth failures", async () => {
    let calls = 0;
    setAuthFailureHandler(() => {
      calls += 1;
    });

    for (const [status, body] of [
      [400, { code: "INVALID_REQUEST", message: "no" }],
      [404, { code: "RESOURCE_NOT_FOUND", message: "no" }],
      [503, { code: "ENGINE_TIMEOUT", message: "no" }],
      [500, { code: "INTERNAL_SERVER_ERROR", message: "no" }],
    ] as const) {
      respond(status, body);
      await apiRequest("/x", { schema: Passthrough }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(calls).toBe(0);
  });

  it("still rejects the caller as well as notifying", async () => {
    respond(401, { code: "TOKEN_EXPIRED", message: "Session expired" });
    setAuthFailureHandler(() => undefined);

    // The interceptor is not a swallow: a caller awaiting data must still see
    // the failure and stop rendering a spinner.
    await expect(
      apiRequest("/x", { schema: Passthrough }),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });
});

describe("transport selection", () => {
  it("calls the backend origin directly — there is no proxy", async () => {
    let seenUrl = "";
    globalThis.fetch = ((input: RequestInfo | URL) => {
      seenUrl = String(input);
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    await apiRequest("/equity/balances", { schema: Passthrough });

    // Cross-origin, same-site: the cookie rides along on credentials:"include".
    expect(seenUrl).toBe("http://localhost:3000/equity/balances");
    // The proxy is gone; nothing should be routed through this app's own origin.
    expect(seenUrl).not.toStartWith("/api/");
  });

  it("sends credentials so the httpOnly cookie is attached", async () => {
    let seenInit: RequestInit = {};
    globalThis.fetch = ((_input: RequestInfo | URL, init: RequestInit = {}) => {
      seenInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    await apiRequest("/equity/balances", { schema: Passthrough });
    expect(seenInit.credentials).toBe("include");
  });

  it("never puts an Authorization header on a browser request", async () => {
    let seenHeaders: Record<string, string> = {};
    globalThis.fetch = ((_input: RequestInfo | URL, init: RequestInit = {}) => {
      seenHeaders = init.headers as Record<string, string>;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    await apiRequest("/equity/balances", { schema: Passthrough });

    // The token is httpOnly and set by the backend on its own host. If this
    // ever starts sending one, the cookie design has been undone.
    expect(seenHeaders.authorization).toBeUndefined();
  });
});
