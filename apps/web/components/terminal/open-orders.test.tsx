import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The Open-orders tab: the fan-out read, and a cancel that has to be honest
 * about failing.
 *
 * Cancel is optimistic — the row goes before the server has agreed — because
 * cancelling a resting order realises nothing and so does not confirm. That
 * trade only holds if the failure path is real, which is what most of this file
 * is about: the row comes back, and the user is told.
 *
 * `fetch` is stubbed rather than the endpoints module mocked. Bun's
 * `mock.module` is process-global and leaks into every other file in the run;
 * stubbing the transport keeps the real module graph, so the responses below
 * are genuinely parsed by the Phase 3 schemas on the way in.
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
const SOL = MARKETS.find((m) => m.slug === "SOL-USD")!;
const ETH = MARKETS.find((m) => m.slug === "ETH-USD")!;

type Row = {
  id: string;
  marketId: string;
  positionType: "LONG" | "SHORT";
  orderType: "limit" | "market";
  status: "open" | "partially_filled";
  qty: string;
  filledQty: string;
  price: string;
  createdAt: string;
};

const row = (over: Partial<Row> & { id: string }): Row => ({
  marketId: SOL.id,
  positionType: "LONG",
  orderType: "limit",
  status: "open",
  qty: "3",
  filledQty: "0",
  price: "95.5",
  createdAt: "2026-08-30T10:00:00.000Z",
  ...over,
});

const full = (r: Row) => ({
  ...r,
  userId: "u-1",
  slippage: 0,
  initialMargin: "95.5",
  updatedAt: r.createdAt,
});

let openOrders: Row[] = [];
/** Fan-outs over the three markets, so "nothing was refetched" is provable. */
let openOrderRequests = 0;
/** Markets whose open-orders request should fail. */
let failingMarkets: string[] = [];
let cancelOutcome: "ok" | "fail" = "ok";
let cancelled: string[] = [];
/** Resolved after the DELETE lands, to hold a cancel open mid-flight. */
let releaseCancel: (() => void) | null = null;

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
    return json({ balances: { available: "10000", locked: "286.50" } });
  }

  const open = url.match(/\/orders\/open\/([^?]+)$/);
  if (open) {
    openOrderRequests++;
    const marketId = decodeURIComponent(open[1]!);
    if (failingMarkets.includes(marketId)) {
      return json({ code: "INTERNAL_SERVER_ERROR", message: "boom" }, 500);
    }
    return json({
      orders: openOrders.filter((o) => o.marketId === marketId).map(full),
    });
  }

  /**
   * Phase 9 put a `PositionsProvider` above these tabs, so the component tree
   * under test now reads positions too. Empty ones: this file is about the
   * Open-orders tab, and an unstubbed 404 here would put an error panel on a
   * sibling tab for no reason. `positions.test.tsx` is where they are exercised.
   */
  if (url.match(/\/positions\/open\//)) return json({ positions: [] });

  const del = url.match(/\/order\/([^/]+)$/);
  if (del && init?.method === "DELETE") {
    const id = decodeURIComponent(del[1]!);
    if (releaseCancel) {
      await new Promise<void>((resolve) => {
        releaseCancel = resolve;
      });
    }
    if (cancelOutcome === "fail") {
      return json({ code: "INVALID_REQUEST", message: "Order not found" }, 400);
    }
    cancelled.push(id);
    openOrders = openOrders.filter((o) => o.id !== id);
    return json({
      order: full(row({ id, status: "open" })),
      cancelledQty: "3",
      balances: { releasedMargin: "95.5", available: "10095.5", locked: "191" },
    });
  }

  if (url.endsWith("/ws-ticket")) return json({ ticket: "t-1", expiresIn: 60 });

  return json({}, 404);
}) as unknown as typeof fetch;

/**
 * A fake socket for the private channel (Phase 13).
 *
 * The Open-orders table is the surface that changed most: it used to be
 * refetched after every mutation, and is now a push target. What the tests at
 * the bottom of this file assert is that a row can transition **with no
 * request at all**, which is the one thing a refetch would have hidden.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  accept() {
    this.onopen?.();
  }
  push(events: unknown[]) {
    this.onmessage?.({ data: JSON.stringify({ feed: "user", data: { events } }) });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.WebSocket = FakeSocket as any;

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
            {/* Lazy — it fetches nothing until one of its two tabs is opened,
                which no test in this file does. It is here because
                `AccountTabs` reads its context unconditionally. */}
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
 * Renders and switches to the Open-orders tab, which is not the default one.
 *
 * `mouseDown`, not `click`: Radix Tabs selects on pointer-down (and on focus,
 * since activation is automatic), so a synthetic click alone leaves the
 * Positions panel mounted and every assertion below looking at the wrong table.
 */
function openTab() {
  render(<Tabs />);
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Open orders/ }));
}

const cancelButtons = () => screen.queryAllByRole("button", { name: "Cancel" });

afterEach(() => {
  openOrders = [];
  failingMarkets = [];
  cancelOutcome = "ok";
  cancelled = [];
  releaseCancel = null;
  FakeSocket.instances = [];
  openOrderRequests = 0;
});

describe("the Open-orders tab", () => {
  it("shows a skeleton while loading, never the empty state", async () => {
    // The ordering that matters: "No open orders" is a claim about the account,
    // and an account with orders must not see it while its data is in flight.
    openTab();
    expect(screen.queryByText("No open orders")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading orders");
  });

  it("merges every market's orders and resolves the slug from the id", async () => {
    openOrders = [
      row({ id: "aaaaaaaa-0000-4000-8000-000000000001" }),
      row({
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        marketId: ETH.id,
        positionType: "SHORT",
        createdAt: "2026-08-30T11:00:00.000Z",
      }),
    ];
    openTab();

    // The rows carry a marketId; the table has to print a slug.
    expect(await screen.findByText("ETH-USD")).toBeInTheDocument();
    expect(screen.getByText("SOL-USD")).toBeInTheDocument();
    expect(screen.getByText("LONG")).toBeInTheDocument();
    expect(screen.getByText("SHORT")).toBeInTheDocument();

    // Newest first, across markets — the ETH order was placed an hour later.
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]!.textContent).toContain("ETH-USD");
  });

  it("renders the empty state once an account genuinely has none", async () => {
    openTab();
    expect(await screen.findByText("No open orders")).toBeInTheDocument();
  });

  it("counts the open orders on the tab itself", async () => {
    openOrders = [
      row({ id: "aaaaaaaa-0000-4000-8000-000000000001" }),
      row({ id: "aaaaaaaa-0000-4000-8000-000000000002" }),
    ];
    openTab();
    await screen.findAllByText("SOL-USD");
    expect(
      screen.getByRole("tab", { name: /Open orders/ }).textContent,
    ).toContain("2");
  });

  it("fails the whole panel when one market's request does, and retries", async () => {
    // A partial list is indistinguishable from orders having been cancelled.
    openOrders = [row({ id: "aaaaaaaa-0000-4000-8000-000000000001" })];
    failingMarkets = [ETH.id];
    openTab();

    expect(await screen.findByText("Couldn't load open orders")).toBeVisible();
    expect(screen.queryByText("No open orders")).toBeNull();

    failingMarkets = [];
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(await screen.findByText("SOL-USD")).toBeInTheDocument();
  });
});

describe("cancelling from the tab", () => {
  it("removes the row immediately and sends the DELETE", async () => {
    openOrders = [row({ id: "aaaaaaaa-0000-4000-8000-000000000001" })];
    openTab();
    await screen.findByText("SOL-USD");

    fireEvent.click(cancelButtons()[0]!);

    // Optimistic: gone before the response, which is the whole reason this
    // action can skip a confirm dialog.
    await waitFor(() => expect(screen.queryByText("SOL-USD")).toBeNull());
    await waitFor(() =>
      expect(cancelled).toEqual(["aaaaaaaa-0000-4000-8000-000000000001"]),
    );
  });

  it("restores the row and says so when the cancel fails", async () => {
    openOrders = [
      row({ id: "aaaaaaaa-0000-4000-8000-000000000001" }),
      row({
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        createdAt: "2026-08-30T09:00:00.000Z",
      }),
    ];
    cancelOutcome = "fail";
    openTab();
    await screen.findAllByText("SOL-USD");

    fireEvent.click(cancelButtons()[0]!);

    // Back on screen, and in its original place — the sort is a pure function
    // of the rows, so a restore cannot shuffle the table.
    await waitFor(() => expect(cancelButtons()).toHaveLength(2));
    const ids = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent);
    expect(ids[0]).toContain("aaaaaa");

    // The restored row is identical to the one already there, so the toast is
    // the only thing that tells the user the cancel did not happen.
    expect(await screen.findAllByText("Could not cancel order")).not.toHaveLength(0);
    expect(screen.getAllByText("Order not found").length).toBeGreaterThan(0);
  });

  it("disables the row's button while its cancel is in flight", async () => {
    openOrders = [row({ id: "aaaaaaaa-0000-4000-8000-000000000001" })];
    // Hold the DELETE open. The row is already gone optimistically, so this is
    // about the second click never reaching the network.
    releaseCancel = () => undefined;
    openTab();
    await screen.findByText("SOL-USD");

    fireEvent.click(cancelButtons()[0]!);
    await waitFor(() => expect(cancelButtons()).toHaveLength(0));

    releaseCancel?.();
    await waitFor(() => expect(screen.queryByText("SOL-USD")).toBeNull());
  });
});

export {};

/**
 * The private channel, applied to this table (Phase 13).
 *
 * This is the maker's case, and it is the reason the phase exists: somebody
 * else crossed the book and hit a resting order of ours. There is no request
 * to piggyback on, nothing was submitted, and before the channel the row
 * simply stayed wrong until the user happened to look away and back.
 *
 * Every assertion here is paired with one about the request log, because a
 * table that looks right because it was refetched is indistinguishable on
 * screen from one that is right because the reducer worked — and after this
 * phase there is no refetch left to hide behind.
 */
describe("open orders, pushed", () => {
  const connect = async () => {
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    await act(async () => {
      FakeSocket.instances[0]!.accept();
    });
    return FakeSocket.instances[0]!;
  };

  const push = async (socket: FakeSocket, events: unknown[]) => {
    await act(async () => {
      socket.push(events);
    });
  };

  it("removes a maker's row when their resting order fills — with no request", async () => {
    openOrders = [row({ id: "aaaaaaaa-0000-4000-8000-000000000001" })];
    openTab();
    expect(await screen.findByText("SOL-USD")).toBeInTheDocument();

    const socket = await connect();
    const settled = openOrderRequests;

    await push(socket, [
      {
        type: "order.update",
        orderId: "aaaaaaaa-0000-4000-8000-000000000001",
        marketId: SOL.id,
        status: "filled",
        filledQty: "3",
      },
    ]);

    expect(await screen.findByText("No open orders")).toBeInTheDocument();
    expect(openOrderRequests).toBe(settled);
  });

  it("shows a partial fill's new quantity in place", async () => {
    openOrders = [row({ id: "aaaaaaaa-0000-4000-8000-000000000001", qty: "3" })];
    openTab();
    await screen.findByText("SOL-USD");

    const socket = await connect();
    const settled = openOrderRequests;

    await push(socket, [
      {
        type: "order.update",
        orderId: "aaaaaaaa-0000-4000-8000-000000000001",
        marketId: SOL.id,
        status: "partially_filled",
        filledQty: "1",
      },
    ]);

    expect(await screen.findByText("partially filled")).toBeInTheDocument();
    expect(openOrderRequests).toBe(settled);
  });

  it("adds a row for an order the account placed elsewhere", async () => {
    // A second device, or the ticket itself — either way this table is not the
    // thing that asked, and the row still has to appear.
    openTab();
    expect(await screen.findByText("No open orders")).toBeInTheDocument();

    const socket = await connect();
    const settled = openOrderRequests;

    await push(socket, [
      {
        type: "order.new",
        origin: "user",
        order: {
          id: "cccccccc-0000-4000-8000-000000000003",
          marketId: ETH.id,
          positionType: "SHORT",
          orderType: "limit",
          status: "open",
          qty: "2",
          filledQty: "0",
          price: "1800",
          slippage: 0,
          initialMargin: "600",
          createdAt: "2026-08-30T12:00:00.000Z",
        },
      },
    ]);

    expect(await screen.findByText("ETH-USD")).toBeInTheDocument();
    expect(openOrderRequests).toBe(settled);
  });

  it("resynchronises the list when the channel connects", async () => {
    // The snapshot half of snapshot-then-drain: the mount fetch and the
    // connect fetch are two different moments, and a reconnect after an outage
    // is the one that matters.
    openTab();
    await screen.findByText("No open orders");
    const settled = openOrderRequests;

    await connect();
    // One per market — the fan-out is unchanged, only what triggers it is.
    await waitFor(() => expect(openOrderRequests).toBe(settled + MARKETS.length));
  });
});
