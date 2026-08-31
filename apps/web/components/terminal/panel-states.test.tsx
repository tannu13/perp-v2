import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Phase 14's honesty sweep, asserted one surface at a time.
 *
 * §6.15 asks for a test per async surface proving the three states render the
 * right atom, and for the ordering that makes them honest: **loading is checked
 * before empty**, everywhere, because "No open positions" is a claim about
 * somebody's account and a request that has not answered yet is not evidence
 * for it. The same rule applies to a request that FAILED, which is the bug this
 * file was written around — the Balances tab had no error branch at all, so a
 * failed balances read rendered a table header over no rows, which reads as an
 * account holding nothing.
 *
 * `fetch` is stubbed rather than the endpoints module mocked, for the reason
 * given in `open-orders.test.tsx`: `mock.module` is process-global under bun
 * and would leak into every other file in the run.
 */

mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: () => undefined,
    push: () => undefined,
    refresh: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

const { MARKETS, DEFAULT_MARKET } = await import("@/lib/markets");

/** Which routes should fail. Empty means every one answers with nothing. */
let failing: RegExp[] = [];
/** Routes held open, so the loading state can be asserted while it is real. */
let pending: RegExp[] = [];

const realFetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);

  if (url.endsWith("/me")) return json({ userId: "u-1", username: "alice" });
  if (url.endsWith("/ws-ticket")) return json({ ticket: "t-1", expiresIn: 60 });

  if (pending.some((p) => p.test(url))) {
    // Never resolves. The component is unmounted by `cleanup` at the end of
    // the test, which is what releases it.
    return new Promise<Response>(() => {});
  }
  if (failing.some((p) => p.test(url))) {
    return json({ code: "INTERNAL_SERVER_ERROR", message: "boom" }, 500);
  }

  if (url.includes("/equity/balances")) {
    return json({ balances: { available: "0", locked: "0" } });
  }
  if (url.includes("/orders/open/")) return json({ orders: [] });
  if (url.includes("/positions/open/")) return json({ positions: [] });
  if (url.includes("/fills")) return json({ fills: [] });
  if (url.includes("/orders/")) return json({ orders: [] });
  if (url.includes("/depth")) return json({ bids: [], asks: [], lastUpdateId: 1 });

  return json({}, 404);
}) as unknown as typeof fetch;

/** The private channel's socket. Never accepted here: these are REST states. */
class SilentSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) {}
  close() {}
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.WebSocket = SilentSocket as any;

const { SessionProvider } = await import("@/lib/auth/session-provider");
const { UserFeedProvider } = await import("@/lib/user-feed");
const { AccountProvider } = await import("@/lib/account");
const { OrdersProvider } = await import("@/lib/orders");
const { PositionsProvider } = await import("@/lib/positions");
const { HistoryProvider } = await import("@/lib/history");
const { ToastProvider } = await import("@/components/ui/toast");
const { TooltipProvider } = await import("@/components/ui/tooltip");
const { AccountTabs } = await import("./account-tabs");

function Tabs() {
  return (
    <SessionProvider>
      <UserFeedProvider>
        <AccountProvider>
          <OrdersProvider markets={MARKETS}>
            <PositionsProvider markets={MARKETS}>
              <HistoryProvider markets={MARKETS}>
                <ToastProvider>
                  <TooltipProvider>
                    <AccountTabs market={DEFAULT_MARKET} />
                  </TooltipProvider>
                </ToastProvider>
              </HistoryProvider>
            </PositionsProvider>
          </OrdersProvider>
        </AccountProvider>
      </UserFeedProvider>
    </SessionProvider>
  );
}

/**
 * Radix unmounts an inactive panel, so a tab has to be opened to be read.
 *
 * `mouseDown` as well as `click`: Radix's tab trigger selects on mouse down —
 * a bare `click()` moves nothing, which is a silent no-op rather than a
 * failure, and every assertion after it then reads the Positions panel.
 */
async function openTab(name: RegExp) {
  const trigger = await screen.findByRole("tab", { name });
  await act(async () => {
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
  });
  return trigger;
}

beforeEach(() => {
  failing = [];
  pending = [];
});

// Restored once, at the very end: the stub is module-level and every test in
// this file needs it. Putting this in an `afterEach` handed the second test
// the real `fetch` and a five-second timeout.
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("loading before empty", () => {
  /**
   * The ordering rule, per surface.
   *
   * Every one of these tables is empty for a brand-new account, so "the
   * skeleton is showing" and "the empty state is showing" look identical from
   * the outside unless the request is still open — which is what `pending`
   * does. What each case proves is that the empty state is NOT on screen
   * while the request that would justify it has not answered.
   */
  const cases: { tab: RegExp; route: RegExp; empty: RegExp; label: RegExp }[] = [
    {
      tab: /positions/i,
      route: /\/positions\/open\//,
      empty: /no open positions/i,
      label: /loading positions/i,
    },
    {
      tab: /open orders/i,
      route: /\/orders\/open\//,
      empty: /no open orders/i,
      label: /loading orders/i,
    },
    {
      tab: /balances/i,
      route: /\/equity\/balances/,
      empty: /no collateral deposited/i,
      label: /loading balances/i,
    },
  ];

  for (const c of cases) {
    it(`shows a skeleton, not "${c.empty.source}", while the request is open`, async () => {
      pending = [c.route];
      render(<Tabs />);
      await openTab(c.tab);

      await waitFor(() =>
        expect(
          // The sr-only sentence inside `SkeletonRegion`'s live region — what
          // a screen reader hears while a table is loading. Queried by text
          // rather than by accessible name: `role="status"` does not take its
          // name from its content, so `getByRole(…, { name })` cannot see it.
          screen.getByText(c.label),
        ).toBeInTheDocument(),
      );
      expect(screen.queryByText(c.empty)).not.toBeInTheDocument();
    });
  }

  /**
   * The two lazy tabs are the same rule with a fourth status in front of it.
   * `idle` — before the tab has ever been opened — renders the skeleton too,
   * because `activate()` fires in the same interaction that reveals the panel
   * and the alternative is one frame of "No fills yet".
   */
  it("shows a skeleton on the lazy tabs from the moment they open", async () => {
    pending = [/\/fills/];
    render(<Tabs />);
    await openTab(/fill history/i);

    await waitFor(() =>
      expect(screen.getByText(/loading fills/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/no fills yet/i)).not.toBeInTheDocument();
  });
});

describe("a failed request is never rendered as an empty account", () => {
  const cases: {
    name: string;
    tab: RegExp;
    route: RegExp;
    error: RegExp;
    empty: RegExp;
  }[] = [
    {
      name: "positions",
      tab: /positions/i,
      route: /\/positions\/open\//,
      error: /couldn't load positions/i,
      empty: /no open positions/i,
    },
    {
      name: "open orders",
      tab: /open orders/i,
      route: /\/orders\/open\//,
      error: /couldn't load open orders/i,
      empty: /no open orders/i,
    },
    {
      // The regression this file exists for: no error branch at all, so the
      // panel fell through to a table with an empty body.
      name: "balances",
      tab: /balances/i,
      route: /\/equity\/balances/,
      error: /couldn't load balances/i,
      empty: /no collateral deposited/i,
    },
    {
      name: "fill history",
      tab: /fill history/i,
      route: /\/fills/,
      error: /couldn't load your fills/i,
      empty: /no fills yet/i,
    },
    {
      name: "order history",
      tab: /order history/i,
      route: /\/fills/,
      error: /couldn't load order history/i,
      empty: /no order history/i,
    },
  ];

  for (const c of cases) {
    it(`${c.name} shows an error, not an empty state`, async () => {
      failing = [c.route];
      render(<Tabs />);
      await openTab(c.tab);

      const alert = await screen.findByText(c.error, {}, { timeout: 5000 });
      expect(alert).toBeInTheDocument();
      expect(screen.queryByText(c.empty)).not.toBeInTheDocument();
    });
  }

  it("gives the balances failure a retry, not just a sentence", async () => {
    failing = [/\/equity\/balances/];
    render(<Tabs />);
    await openTab(/balances/i);

    await screen.findByText(/couldn't load balances/i, {}, { timeout: 5000 });
    // A collateral table with no rows in it has no USD row either; the point
    // of the error branch is that neither is on screen.
    expect(screen.queryByText("USD")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });
});

describe("the ordinary empty states still render", () => {
  it("says the account has no positions once the request says so", async () => {
    render(<Tabs />);
    await openTab(/positions/i);
    expect(
      await screen.findByText(/no open positions/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it("offers a deposit from the empty balances tab", async () => {
    render(<Tabs />);
    await openTab(/balances/i);
    expect(
      await screen.findByText(/no collateral deposited/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
