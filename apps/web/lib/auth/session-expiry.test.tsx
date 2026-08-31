import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";

/**
 * What happens when a session expires with the terminal open.
 *
 * §6.15: "a 401 mid-session shows one toast and one redirect carrying `next=`,
 * and in-flight requests are cancelled rather than each producing their own
 * error." Three separate claims, and each of them fails in a different way —
 * five toasts, a redirect that lost the return path, or five error panels
 * appearing on a screen the user is being navigated away from.
 *
 * The counting is what makes this a test rather than a screenshot. A single
 * redirect and five redirects to the same URL look identical afterwards.
 */

declare global {
  // eslint-disable-next-line no-var
  var happyDOM: { setURL?: (url: string) => void } | undefined;
}

const replaced: string[] = [];

mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => {
      replaced.push(href);
    },
    push: () => undefined,
    refresh: () => undefined,
  }),
  usePathname: () => "/trade/SOL-USD",
  useSearchParams: () => new URLSearchParams(),
}));

/** Routes that answer 401. The session is alive until this is populated. */
let expired = false;
/** Requests that were still open when the session ended, keyed by route. */
let released: Array<() => void> = [];
let outcomes: string[] = [];

const realFetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/me")) return json({ userId: "u-1", username: "alice" });

  if (url.includes("/equity/balances")) {
    if (expired) {
      return json({ code: "TOKEN_EXPIRED", message: "Session expired" }, 401);
    }
    return json({ balances: { available: "100", locked: "0" } });
  }

  /**
   * A read that never answers on its own.
   *
   * It is released only by the abort signal the transport links it to, which
   * is the behaviour under test: without the session scope this request stays
   * open forever and its provider stays in `loading` on a signed-out screen.
   */
  if (url.includes("/positions/open/")) {
    return new Promise<Response>((_resolve, reject) => {
      released.push(() => reject(new DOMException("aborted", "AbortError")));
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  }

  return json({}, 404);
}) as unknown as typeof fetch;

const { apiRequest, resetAuthFailureLatch } = await import("@/lib/api/http");
const { ApiError } = await import("@/lib/api/errors");
const { SessionProvider, useSession } = await import("./session-provider");
const { ToastProvider } = await import("@/components/ui/toast");
const { SessionNotice } = await import("@/components/chrome/session-notice");
const { z } = await import("zod");

const Positions = z.object({ positions: z.array(z.unknown()) });
const Balances = z.object({ balances: z.unknown() });

beforeEach(() => {
  replaced.length = 0;
  released = [];
  outcomes = [];
  expired = false;
  resetAuthFailureLatch();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

/** Renders the pieces that own the expiry: the interceptor and the notice. */
function Harness() {
  return (
    <SessionProvider>
      <ToastProvider>
        <SessionNotice />
        <Probe />
      </ToastProvider>
    </SessionProvider>
  );
}

/** Exposes the session so a test can wait for the boot probe to settle. */
function Probe() {
  const { status } = useSession();
  return <span data-testid="status">{status}</span>;
}

async function signedIn() {
  render(<Harness />);
  await waitFor(() =>
    expect(screen.getByTestId("status")).toHaveTextContent("authed"),
  );
}

describe("one toast and one redirect", () => {
  it("announces an expired session once, however many requests 401", async () => {
    await signedIn();
    expired = true;

    // Six tables refetching on one screen — the shape the terminal actually
    // has, and the reason the latch in `http.ts` exists.
    await act(async () => {
      await Promise.all(
        Array.from({ length: 6 }, () =>
          apiRequest("/equity/balances", { schema: Balances }).catch(
            () => undefined,
          ),
        ),
      );
    });

    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(screen.getAllByText(/session expired/i)).toHaveLength(1);
  });

  it("redirects once, and the redirect carries the way back", async () => {
    /**
     * The interceptor reads `window.location`, not the router's pathname: it
     * needs the search string too, and `usePathname` does not carry one.
     *
     * happy-dom starts on `about:blank`, where `pathname` is the string
     * "blank" and `pushState` on a relative URL does not move it — so the URL
     * has to be set outright before the expiry.
     */
    window.happyDOM?.setURL?.("http://localhost/trade/SOL-USD?tab=orders");
    await signedIn();
    expired = true;

    await act(async () => {
      await Promise.all(
        Array.from({ length: 4 }, () =>
          apiRequest("/equity/balances", { schema: Balances }).catch(
            () => undefined,
          ),
        ),
      );
    });

    expect(replaced).toHaveLength(1);
    // `next=` is the whole reason this is a redirect rather than a sign-out:
    // it is what brings the user back to the screen they were working on.
    expect(replaced[0]).toContain("/signin?next=");
    // The QUERY STRING survives, which is the half that used to be lost:
    // `RequireSession` redirects too, from the same state change, and it knows
    // only the pathname — so whichever of the two ran last decided the URL.
    expect(decodeURIComponent(replaced[0]!)).toContain(
      "/trade/SOL-USD?tab=orders",
    );
  });
});

describe("in-flight requests are cancelled, not left to fail one by one", () => {
  it("rejects an open request with CANCELLED when the session ends", async () => {
    await signedIn();

    // Two reads that will still be open when the 401 lands.
    const open = [0, 1].map((i) =>
      apiRequest(`/positions/open/m-${i}`, { schema: Positions }).catch(
        (err: unknown) => {
          outcomes.push(err instanceof ApiError ? err.code : "not-an-ApiError");
        },
      ),
    );

    expired = true;
    await act(async () => {
      await apiRequest("/equity/balances", { schema: Balances }).catch(
        () => undefined,
      );
      await Promise.all(open);
    });

    expect(outcomes).toEqual(["CANCELLED", "CANCELLED"]);
  });

  it("marks a cancelled request silent, so no panel reports it", async () => {
    // The property every provider branches on: an error that is `isSilent` is
    // not rendered anywhere, because the expiry is already being reported once
    // by the toast and the redirect.
    const cancelled = new ApiError({
      status: 0,
      code: "CANCELLED",
      message: "The request was cancelled because the session ended.",
    });
    expect(cancelled.isSilent).toBe(true);
    expect(cancelled.isCancelled).toBe(true);
    // And it is not mistaken for a timeout, which IS shown with a retry.
    expect(cancelled.isRetryable).toBe(false);
  });

  it("leaves a public request alone — the ladder must survive a sign-out", async () => {
    // `auth: false` routes never join the session scope: `GET /depth` and
    // `GET /markets` work signed out, and the book is what prices the order
    // the user will place after signing in again.
    const { abortSessionRequests } = await import("@/lib/api/http");
    let code: string | null = null;
    const request = apiRequest("/positions/open/public-probe", {
      schema: Positions,
      auth: false,
    }).catch((err: unknown) => {
      code = err instanceof ApiError ? err.code : "not-an-ApiError";
    });

    abortSessionRequests();
    // Nothing aborted it, so it is still open; release it by hand.
    released.forEach((release) => release());
    await request;

    expect(code).not.toBe("CANCELLED");
  });
});
