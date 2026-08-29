import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SessionProvider, useSession } from "./session-provider";

/**
 * The session provider.
 *
 * `next/navigation` is mocked because there is no Next router in a unit test;
 * what matters is which navigations are requested, so the mock records them.
 */

const replaced: string[] = [];
let refreshes = 0;

mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: (href: string) => replaced.push(href),
    push: (href: string) => replaced.push(href),
    refresh: () => {
      refreshes += 1;
    },
  }),
}));

const realFetch = globalThis.fetch;

/**
 * Keyed on path SUFFIX, not the full URL: the client now calls the backend's
 * own origin rather than a same-origin proxy, so the host is configuration.
 */
function mockRoutes(handlers: Record<string, () => Response>) {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(handlers).find((path) => url.endsWith(path));
    if (!key) {
      return Promise.resolve(
        new Response(JSON.stringify({ code: "TOKEN_MISSING" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(handlers[key]!());
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function Probe() {
  const { status, identity, signOut } = useSession();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="who">{identity?.username ?? "-"}</span>
      <button onClick={() => void signOut()}>sign out</button>
    </div>
  );
}

afterEach(() => {
  globalThis.fetch = realFetch;
  replaced.length = 0;
  refreshes = 0;
});

describe("SessionProvider", () => {
  it("starts in loading so the server and first client render agree", async () => {
    mockRoutes({ "/me": () => json({ code: "TOKEN_MISSING" }, 401) });

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    // Resolution happens only in the effect; a synchronous "anon" here would be
    // a hydration mismatch waiting to happen.
    expect(screen.getByTestId("status").textContent).toBe("loading");

    // Let the mount effect settle so the pending fetch does not resolve into a
    // torn-down tree and warn.
    await act(async () => undefined);
  });

  it("restores a session from the cookie across a reload", async () => {
    mockRoutes({
      "/me": () => json({ userId: "u-1", username: "alice" }),
    });

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("authed"),
    );
    expect(screen.getByTestId("who").textContent).toBe("alice");
  });

  it("resolves to anon when there is no cookie", async () => {
    mockRoutes({ "/me": () => json({ code: "TOKEN_MISSING" }, 401) });

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("anon"),
    );
  });

  it("resolves to anon when the session route is unreachable", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new TypeError("boom"))) as unknown as typeof fetch;

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    // Never stuck on a spinner: the app must reach a decided state.
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("anon"),
    );
  });

  it("clears identity on sign out", async () => {
    mockRoutes({
      "/me": () => json({ userId: "u-1", username: "alice" }),
      "/signout": () => json({ ok: true }),
    });

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("authed"),
    );

    // fireEvent wraps the dispatch in act(), so the state update it causes
    // is flushed before the assertion rather than warned about.
    fireEvent.click(screen.getByText("sign out"));

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("anon"),
    );
    expect(screen.getByTestId("who").textContent).toBe("-");
  });

  it("still signs out locally when the signout call fails", async () => {
    let first = true;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      if (String(input).endsWith("/me") && first) {
        first = false;
        return Promise.resolve(json({ userId: "u-1", username: "alice" }));
      }
      // The network dies exactly when the user asks to leave.
      return Promise.reject(new TypeError("offline"));
    }) as unknown as typeof fetch;

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("authed"),
    );

    // fireEvent wraps the dispatch in act(), so the state update it causes
    // is flushed before the assertion rather than warned about.
    fireEvent.click(screen.getByText("sign out"));

    // The tab must stop behaving as though someone is signed in regardless.
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("anon"),
    );
  });

  it("throws a useful error outside the provider", () => {
    const previous = console.error;
    console.error = () => undefined;
    try {
      expect(() => render(<Probe />)).toThrow(/useSession must be used inside/);
    } finally {
      console.error = previous;
    }
  });
});
