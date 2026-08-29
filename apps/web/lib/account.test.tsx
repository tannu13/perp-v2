import { afterEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Only `next/navigation` is module-mocked, and with the same shape the auth
 * form suite uses — bun's module mocks are process-global, so two files
 * disagreeing about one module is how a suite starts failing depending on the
 * order it ran in.
 */
mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: () => undefined,
    push: () => undefined,
    refresh: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

const { SessionProvider } = await import("./auth/session-provider");

/**
 * The account snapshot.
 *
 * The mapping is the point: the engine speaks `available` / `locked`, the UI
 * speaks available / margin used / equity, and equity is a sum that must not
 * pass through a float.
 *
 * Stubs `fetch` rather than mocking modules. Bun's `mock.module` is
 * process-global and leaks into every other test file in the run — an earlier
 * version of this file replaced `@/lib/api/endpoints` with a two-export stub
 * and broke three unrelated suites. Stubbing the transport keeps the real
 * module graph and exercises the provider through `apiRequest` as it actually
 * runs.
 */

type Balances = { available: string; locked: string } | "fail";

let balances: Balances = { available: "0", locked: "0" };
let session: { userId: string; username: string } | null = {
  userId: "u-1",
  username: "alice",
};
let balanceCalls = 0;

const realFetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

globalThis.fetch = ((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/me")) {
    return session
      ? Promise.resolve(json(session))
      : Promise.resolve(json({ code: "TOKEN_MISSING" }, 401));
  }
  if (url.includes("/equity/balances")) {
    balanceCalls += 1;
    if (balances === "fail") {
      return Promise.resolve(
        json({ code: "INTERNAL_SERVER_ERROR", message: "boom" }, 500),
      );
    }
    return Promise.resolve(json({ balances }));
  }
  return Promise.resolve(json({}, 404));
}) as unknown as typeof fetch;

const { AccountProvider, useAccount, marginSplit } = await import("./account");

function Probe() {
  const account = useAccount();
  return (
    <div>
      <span data-testid="status">{account.status}</span>
      <span data-testid="equity">{account.data?.equity ?? "-"}</span>
      <span data-testid="available">{account.data?.available ?? "-"}</span>
      <span data-testid="margin">{account.data?.marginUsed ?? "-"}</span>
      <span data-testid="pnl">{String(account.data?.unrealisedPnl)}</span>
      <span data-testid="error">{account.error ?? "-"}</span>
      <button onClick={() => account.retry()}>retry</button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <SessionProvider>
      <AccountProvider>
        <Probe />
      </AccountProvider>
    </SessionProvider>,
  );

afterEach(() => {
  session = { userId: "u-1", username: "alice" };
  balances = { available: "0", locked: "0" };
  balanceCalls = 0;
});

describe("AccountProvider", () => {
  it("maps engine vocabulary onto the UI's", async () => {
    balances = { available: "1958.10", locked: "562.90" };
    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("available").textContent).toBe("1958.10");
    // `locked` is what the UI calls margin used.
    expect(screen.getByTestId("margin").textContent).toBe("562.90");
    // equity = available + locked, added as strings.
    expect(screen.getByTestId("equity").textContent).toBe("2521.00");
  });

  it("reports unrealised PnL as null, never zero", async () => {
    balances = { available: "10", locked: "0" };
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    // A zero here would be a confident lie until Phase 9 can derive it.
    expect(screen.getByTestId("pnl").textContent).toBe("null");
  });

  it("surfaces a failure as an error state, not an empty balance", async () => {
    balances = "fail";
    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );
    // Showing $0.00 when the request failed would be worse than showing nothing.
    expect(screen.getByTestId("equity").textContent).toBe("-");
  });

  it("re-requests on retry", async () => {
    balances = "fail";
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );

    balances = { available: "5", locked: "0" };
    fireEvent.click(screen.getByText("retry"));

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("equity").textContent).toBe("5");
  });

  it("never requests balances while anonymous", async () => {
    // An unguarded fetch here would 401, and the interceptor turns a 401 into a
    // redirect — so this would bounce every visitor off the landing page.
    session = null;
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("loading"),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(balanceCalls).toBe(0);
  });
});

describe("marginSplit", () => {
  it("splits used against free for the Seam", () => {
    expect(
      marginSplit({
        equity: "2521.00",
        available: "1958.10",
        marginUsed: "562.90",
        unrealisedPnl: null,
      }),
    ).toEqual({ used: 562.9, free: 1958.1 });
  });
});
