import { afterEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The two historical tabs: Fill history and Order history.
 *
 * Three things are under test and each of them is a way the table could lie.
 *
 * 1. **Order history must not duplicate Open orders.** Only terminal rows.
 * 2. **A market order's price is its executed average, never `orders.price`** —
 *    that column holds the 0 the client sent (G29).
 * 3. **Neither tab fetches until it is opened.** Asserted against the request
 *    log rather than the UI: a lazily-loaded panel and an eagerly-loaded one
 *    look identical once the rows are there.
 *
 * `fetch` is stubbed rather than the endpoints module mocked — `mock.module` in
 * Bun is process-global and leaks into every other file in the run. This way
 * the responses below are genuinely parsed by the Phase 3 schemas on the way in.
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

type OrderRow = {
  id: string;
  marketId: string;
  positionType: "LONG" | "SHORT";
  orderType: "limit" | "market";
  status: "pending" | "open" | "partially_filled" | "filled" | "cancelled";
  qty: string;
  filledQty: string;
  price: string;
  createdAt: string;
};

const order = (over: Partial<OrderRow> & { id: string }): OrderRow => ({
  marketId: SOL.id,
  positionType: "LONG",
  orderType: "limit",
  status: "filled",
  qty: "3",
  filledQty: "3",
  price: "95.5",
  createdAt: "2026-08-30T10:00:00.000Z",
  ...over,
});

const fullOrder = (o: OrderRow) => ({
  ...o,
  userId: "u-1",
  slippage: 0,
  initialMargin: "286.5",
  updatedAt: o.createdAt,
});

type FillRow = {
  id: string;
  marketId: string;
  marketSlug: string;
  side: "LONG" | "SHORT";
  role: "maker" | "taker";
  orderId: string;
  qty: string;
  price: string;
  createdAt: string;
};

const fill = (over: Partial<FillRow> & { id: string }): FillRow => ({
  marketId: SOL.id,
  marketSlug: "SOL-USD",
  side: "LONG",
  role: "taker",
  orderId: "o-1",
  qty: "3",
  price: "95.5",
  createdAt: "2026-08-30T10:00:00.000Z",
  ...over,
});

let allOrders: OrderRow[] = [];
/** Pages of fills, served in order; each response's cursor points at the next. */
let fillPages: FillRow[][] = [[]];
let failFills = false;
/** Every path fetch was asked for, in order — the laziness assertion. */
let requested: string[] = [];

/** Kept for parity with the other terminal suites; each installs its own. */
const realFetch = globalThis.fetch;
void realFetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  requested.push(url);

  if (url.endsWith("/me")) return json({ userId: "u-1", username: "alice" });
  if (url.includes("/equity/balances")) {
    return json({ balances: { available: "10000", locked: "0" } });
  }
  if (url.match(/\/orders\/open\//)) return json({ orders: [] });
  if (url.match(/\/positions\/open\//)) return json({ positions: [] });

  if (url.includes("/fills")) {
    if (failFills) {
      return json({ code: "INTERNAL_SERVER_ERROR", message: "boom" }, 500);
    }
    const before = new URL(url, "http://x").searchParams.get("before");
    const index = before ? Number(before) : 0;
    return json({
      fills: fillPages[index] ?? [],
      nextCursor: fillPages[index + 1] ? String(index + 1) : null,
    });
  }

  const all = url.match(/\/orders\/([^?]+)$/);
  if (all) {
    const marketId = decodeURIComponent(all[1]!);
    return json({
      orders: allOrders.filter((o) => o.marketId === marketId).map(fullOrder),
    });
  }

  return json({}, 404);
}) as unknown as typeof fetch;

const { SessionProvider } = await import("@/lib/auth/session-provider");
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
    </SessionProvider>
  );
}

/**
 * `mouseDown`, not `click`: Radix Tabs selects on pointer-down, so a synthetic
 * click leaves the previous panel mounted and every assertion below reads the
 * wrong table.
 */
function openTab(name: RegExp) {
  render(<Tabs />);
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

const bodyRows = () => screen.getAllByRole("row").slice(1);

/**
 * The Price cell of one Order-history row, by column index.
 *
 * Positional rather than by text: the assertions below are about what is in
 * THIS column, and a bare `getByText("—")` would match several cells and then
 * serialise the whole terminal to describe the ambiguity, which does not come
 * back. Same trap as the anchored regex in PROGRESS.md, from the other side.
 */
const HISTORY_PRICE_COLUMN = 5;
const historyPriceCell = (index = 0) =>
  bodyRows()[index]!.children[HISTORY_PRICE_COLUMN]!.textContent;

afterEach(() => {
  allOrders = [];
  fillPages = [[]];
  failFills = false;
  requested = [];
});

describe("laziness", () => {
  it("fetches no history until a historical tab is opened", async () => {
    render(<Tabs />);
    // Let the eager providers settle so this is not just a timing artefact.
    await screen.findByText("No open positions");

    expect(requested.some((u) => u.includes("/fills"))).toBe(false);
    // `/orders/<id>` — the history fan-out. `/orders/open/<id>` is the other tab.
    expect(requested.some((u) => /\/orders\/[^/]+$/.test(u))).toBe(false);
  });

  it("fetches both lists on the first activation", async () => {
    openTab(/Fill history/);
    await waitFor(() =>
      expect(requested.some((u) => u.includes("/fills"))).toBe(true),
    );
    // Order history is loaded WITH the fills, not separately: a market order's
    // executed price exists nowhere else.
    expect(requested.filter((u) => /\/orders\/[^/]+$/.test(u))).toHaveLength(
      MARKETS.length,
    );
  });
});

describe("the Fill history tab", () => {
  it("shows a skeleton first, never the empty state", async () => {
    // "No fills yet" is a claim about the account and must not flash before
    // the request lands.
    openTab(/Fill history/);
    expect(screen.queryByText("No fills yet")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading fills");
  });

  it("renders the account's own side and role, newest first", async () => {
    fillPages = [
      [
        fill({ id: "f1", side: "SHORT", role: "maker", price: "95.5" }),
        fill({
          id: "f2",
          marketId: ETH.id,
          marketSlug: "ETH-USD",
          side: "LONG",
          role: "taker",
          createdAt: "2026-08-30T11:00:00.000Z",
        }),
      ],
    ];
    openTab(/Fill history/);

    expect(await screen.findByText("ETH-USD")).toBeInTheDocument();
    expect(screen.getByText("SOL-USD")).toBeInTheDocument();
    // Direction never travels by colour alone — the word is in the row.
    expect(screen.getByText("SHORT")).toBeInTheDocument();
    expect(screen.getByText("LONG")).toBeInTheDocument();
    expect(screen.getByText("maker")).toBeInTheDocument();
    expect(screen.getByText("taker")).toBeInTheDocument();

    expect(bodyRows()[0]!.textContent).toContain("ETH-USD");
  });

  it("has no Fee column", async () => {
    // No fee exists anywhere in the system; the column used to hold
    // `price × qty × 0.0004`, an invented number in a table of real ones (D4).
    fillPages = [[fill({ id: "f1" })]];
    openTab(/Fill history/);
    await screen.findByText("SOL-USD");

    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Time", "Market", "Side", "Price", "Qty", "Role"]);
  });

  it("keeps both halves of a self-trade", async () => {
    // One fill id, two roles. Keying on the id alone would drop one.
    fillPages = [
      [
        fill({ id: "same", role: "maker", side: "SHORT", orderId: "o-a" }),
        fill({ id: "same", role: "taker", side: "LONG", orderId: "o-b" }),
      ],
    ];
    openTab(/Fill history/);
    await screen.findByText("maker");

    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByText("taker")).toBeInTheDocument();
  });

  it("pages backwards through the cursor and stops when it runs out", async () => {
    fillPages = [
      [fill({ id: "f1", createdAt: "2026-08-30T12:00:00.000Z" })],
      [
        fill({
          id: "f2",
          marketId: ETH.id,
          marketSlug: "ETH-USD",
          createdAt: "2026-08-30T09:00:00.000Z",
        }),
      ],
    ];
    openTab(/Fill history/);
    await screen.findByText("SOL-USD");

    const more = screen.getByRole("button", { name: /Load older fills/ });
    fireEvent.click(more);

    expect(await screen.findByText("ETH-USD")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(2);
    // Last page: the button goes rather than offering more of nothing.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Load older fills/ }),
      ).toBeNull(),
    );
  });

  it("offers no pager when the first page is the only page", async () => {
    fillPages = [[fill({ id: "f1" })]];
    openTab(/Fill history/);
    await screen.findByText("SOL-USD");

    expect(screen.queryByRole("button", { name: /Load older fills/ })).toBeNull();
  });

  it("fails the panel and retries rather than showing an empty history", async () => {
    failFills = true;
    openTab(/Fill history/);

    expect(await screen.findByText("Couldn't load your fills")).toBeVisible();
    expect(screen.queryByText("No fills yet")).toBeNull();

    failFills = false;
    fillPages = [[fill({ id: "f1" })]];
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(await screen.findByText("SOL-USD")).toBeInTheDocument();
  });

  it("renders the empty state once an account genuinely has none", async () => {
    openTab(/Fill history/);
    expect(await screen.findByText("No fills yet")).toBeInTheDocument();
  });
});

describe("the Order history tab", () => {
  it("shows terminal orders only", async () => {
    // A row in both this table and Open orders — one with a Cancel button and
    // one without — reads as two orders.
    allOrders = [
      order({ id: "aaaaaaaa-0000-4000-8000-000000000001", status: "filled" }),
      order({ id: "bbbbbbbb-0000-4000-8000-000000000002", status: "cancelled" }),
      order({ id: "cccccccc-0000-4000-8000-000000000003", status: "open" }),
      order({
        id: "dddddddd-0000-4000-8000-000000000004",
        status: "partially_filled",
      }),
      order({ id: "eeeeeeee-0000-4000-8000-000000000005", status: "pending" }),
    ];
    openTab(/Order history/);

    await screen.findByText("filled");
    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByText("cancelled")).toBeInTheDocument();
    expect(screen.queryByText("open")).toBeNull();
    expect(screen.queryByText("partially filled")).toBeNull();
    expect(screen.queryByText("pending")).toBeNull();
  });

  it("prices a market order from its fills, not from orders.price", async () => {
    // G29. The row's own price column is the 0 the client sent.
    const marketOrder = order({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      orderType: "market",
      price: "0",
      qty: "10",
      filledQty: "10",
    });
    allOrders = [marketOrder];
    fillPages = [
      [
        fill({ id: "f1", orderId: marketOrder.id, price: "95", qty: "9" }),
        fill({ id: "f2", orderId: marketOrder.id, price: "99", qty: "1" }),
      ],
    ];
    openTab(/Order history/);

    await screen.findByText("filled");
    // Volume-weighted: 95.40, not the unweighted 97.00 and never the 0.00 that
    // `orders.price` would give.
    expect(historyPriceCell()).toBe("95.40");
  });

  it("gives a market order with no fills an em dash", async () => {
    allOrders = [
      order({
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        orderType: "market",
        price: "0",
        status: "cancelled",
        filledQty: "0",
      }),
    ];
    openTab(/Order history/);

    await screen.findByText("cancelled");
    expect(historyPriceCell()).toBe("—");
  });

  it("still prints a limit order's own limit price", async () => {
    allOrders = [
      order({ id: "aaaaaaaa-0000-4000-8000-000000000001", price: "95.5" }),
    ];
    openTab(/Order history/);

    await screen.findByText("filled");
    expect(historyPriceCell()).toBe("95.50");
  });

  it("resolves the market slug from the id and merges every market", async () => {
    allOrders = [
      order({ id: "aaaaaaaa-0000-4000-8000-000000000001" }),
      order({
        id: "bbbbbbbb-0000-4000-8000-000000000002",
        marketId: ETH.id,
        positionType: "SHORT",
        createdAt: "2026-08-30T11:00:00.000Z",
      }),
    ];
    openTab(/Order history/);

    expect(await screen.findByText("ETH-USD")).toBeInTheDocument();
    expect(screen.getByText("SOL-USD")).toBeInTheDocument();
    expect(screen.getByText("SHORT")).toBeInTheDocument();
    // Newest first, across markets.
    expect(bodyRows()[0]!.textContent).toContain("ETH-USD");
  });

  it("renders the empty state once an account genuinely has none", async () => {
    openTab(/Order history/);
    expect(await screen.findByText("No order history")).toBeInTheDocument();
  });
});
