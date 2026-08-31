import { afterEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The Positions tab: derived columns bound to real rows, and a Close that must
 * not fire before the user has confirmed it.
 *
 * The confirm is the load-bearing assertion here. Closing realises PnL at a
 * price the book decides and there is no undo, which is precisely the case
 * CLAUDE.md says must confirm — so "the dialog appears and NO request is made"
 * and "cancelling issues none" are both asserted against the request log rather
 * than against the UI, because a dialog that renders while the order is already
 * in flight looks identical.
 *
 * `fetch` is stubbed rather than the endpoints module mocked, for the reason
 * spelled out in `open-orders.test.tsx`: bun's `mock.module` is process-global.
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
  marketId: string;
  type: "LONG" | "SHORT";
  qty: string;
  margin: string;
  averagePrice: string;
  liquidationPrice: string;
  /** The engine's stale netting figure. Nothing may render it. */
  pnL?: string;
};

const row = (over: Partial<Row> = {}): Row => ({
  marketId: SOL.id,
  type: "LONG",
  qty: "10",
  margin: "250",
  averagePrice: "100",
  liquidationPrice: "90",
  ...over,
});

let positions: Row[] = [];
/** Per-market book, as `GET /depth` would return it. */
let books: Record<string, { bids: [string, string][]; asks: [string, string][] }> = {};
let failingMarkets: string[] = [];
let failingDepth: string[] = [];
let orderOutcome: "ok" | "fail" | "engine-down" = "ok";
/** Every POST /order body seen, so "no request was made" is provable. */
let ordersPosted: Record<string, unknown>[] = [];
/** Positions fan-outs, so "the close refetched nothing" is provable too. */
let positionRequests = 0;

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
    return json({ balances: { available: "10000", locked: "250" } });
  }
  if (url.match(/\/orders\/open\//)) return json({ orders: [] });

  const open = url.match(/\/positions\/open\/([^?]+)$/);
  if (open) {
    positionRequests++;
    const marketId = decodeURIComponent(open[1]!);
    if (failingMarkets.includes(marketId)) {
      return json({ code: "INTERNAL_SERVER_ERROR", message: "boom" }, 500);
    }
    return json({ positions: positions.filter((p) => p.marketId === marketId) });
  }

  const depth = url.match(/\/depth\?marketId=(.+)$/);
  if (depth) {
    const marketId = decodeURIComponent(depth[1]!);
    if (failingDepth.includes(marketId)) {
      return json({ code: "INTERNAL_SERVER_ERROR", message: "boom" }, 500);
    }
    return json({
      market: marketId,
      lastUpdateId: 1,
      timestamp: 0,
      bids: books[marketId]?.bids ?? [],
      asks: books[marketId]?.asks ?? [],
    });
  }

  if (url.endsWith("/order") && init?.method === "POST") {
    ordersPosted.push(JSON.parse(String(init.body)));
    if (orderOutcome === "fail") {
      return json(
        { code: "INVALID_REQUEST", message: "There are no matches available" },
        400,
      );
    }
    if (orderOutcome === "engine-down") {
      // Exactly what `backend-comms.ts` answers when the engine does not
      // reply inside ENGINE_TIMEOUT_MS.
      return json(
        {
          code: "ENGINE_TIMEOUT",
          message: "The matching engine is not responding",
        },
        503,
      );
    }
    // The close filled: the position is gone from the next read.
    positions = [];
    return json({
      orderId: "o-1",
      status: "filled",
      filledQty: "10",
      totalPrice: "1100",
      averagePrice: "110",
      fills: [],
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
    </SessionProvider>
  );
}

/** Positions is the default tab, so no Radix pointer-down dance is needed. */
const renderTabs = () => render(<Tabs />);

afterEach(() => {
  positions = [];
  books = {};
  failingMarkets = [];
  failingDepth = [];
  orderOutcome = "ok";
  ordersPosted = [];
  positionRequests = 0;
});

describe("the Positions tab", () => {
  it("shows a skeleton while loading, never the empty state", async () => {
    // "No open positions" is a claim about the account, and an account with
    // positions must not see it while its data is in flight.
    renderTabs();
    expect(screen.queryByText("No open positions")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading positions");
  });

  it("merges every market's positions and resolves the slug from the id", async () => {
    positions = [row(), row({ marketId: ETH.id, type: "SHORT" })];
    renderTabs();

    expect(await screen.findByText("SOL-USD")).toBeInTheDocument();
    expect(screen.getByText("ETH-USD")).toBeInTheDocument();
    expect(screen.getByText("LONG")).toBeInTheDocument();
    expect(screen.getByText("SHORT")).toBeInTheDocument();
  });

  it("derives PnL and ROE from the book's mid, not from the server's pnL", async () => {
    // The engine's `pnL` is only written during netting (G12). A row carrying a
    // wildly wrong one must still show the number derived from the mark.
    positions = [row({ pnL: "-9999" })];
    books[SOL.id] = { bids: [["109", "5"]], asks: [["111", "5"]] };
    renderTabs();

    // mid 110, LONG 10 @ 100 → +100.00 on 250 margin → +40.00%
    expect(await screen.findByText("+100.00 USD")).toBeInTheDocument();
    expect(screen.getByText("+40.00%")).toBeInTheDocument();
    expect(screen.queryByText(/9999/)).toBeNull();
  });

  it("shows an em dash, not a zero, when the book has no two-sided mid", async () => {
    positions = [row()];
    books[SOL.id] = { bids: [["99", "5"]], asks: [] };
    renderTabs();

    await screen.findByText("SOL-USD");
    // Entry and liquidation are still true and still rendered; only the two
    // price-derived cells — Mark and PnL — go to an em dash.
    expect(screen.getByText("100.00")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("keeps the rows when a depth request fails", async () => {
    // A missing mark blanks one column. A missing position would be
    // indistinguishable from a closed one — which is why only the positions
    // fan-out fails the panel.
    positions = [row()];
    failingDepth = [SOL.id];
    renderTabs();

    expect(await screen.findByText("SOL-USD")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load positions")).toBeNull();
  });

  it("fails the whole panel when a positions request fails", async () => {
    positions = [row(), row({ marketId: ETH.id })];
    failingMarkets = [ETH.id];
    renderTabs();

    expect(await screen.findByText("Couldn't load positions")).toBeInTheDocument();
    // Not a partial list: a position silently omitted looks like one that closed.
    expect(screen.queryByText("SOL-USD")).toBeNull();
  });

  it("renders the empty state once an account genuinely has none", async () => {
    renderTabs();
    expect(await screen.findByText("No open positions")).toBeInTheDocument();
  });
});

describe("closing a position", () => {
  const openDialog = async () => {
    positions = [row()];
    books[SOL.id] = { bids: [["109", "5"]], asks: [["111", "5"]] };
    renderTabs();
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    return screen.findByRole("dialog");
  };

  it("confirms first, and issues NO request until it is confirmed", async () => {
    await openDialog();

    expect(screen.getByText("Close SOL-USD position?")).toBeInTheDocument();
    // The assertion that matters: the dialog being on screen is not proof the
    // order has not already gone.
    expect(ordersPosted).toHaveLength(0);
  });

  it("issues no request when the confirm is dismissed", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Keep position" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(ordersPosted).toHaveLength(0);
  });

  it("sends an opposite-side, full-size market order with no equity", async () => {
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Close position" }));

    await waitFor(() => expect(ordersPosted).toHaveLength(1));
    // G13 on the wire, not just in the builder's unit test.
    expect(ordersPosted[0]).toEqual({
      orderType: "market",
      price: 0,
      slippage: 1,
      market: "SOL-USD",
      type: "SHORT",
      qty: 10,
    });
  });

  it("closes the dialog on success — and refetches nothing", async () => {
    /**
     * Phase 13 changed what removes the row. The close used to await a refetch
     * of every market's positions; it now awaits only the engine's answer, and
     * the row leaves when the `position: null` event arrives on the private
     * channel — `user-feed.test.tsx` drives exactly that.
     *
     * The dialog still closes only after the request resolves, which was never
     * about staleness: a close can be refused outright, and the user has to be
     * looking at the dialog when it is.
     *
     * The last assertion is the honest consequence of deleting the refetch. No
     * channel is mounted in this tree, so nothing here tells it the position
     * is gone — and the row correctly stays rather than vanishing on a guess.
     */
    await openDialog();
    const before = positionRequests;
    fireEvent.click(screen.getByRole("button", { name: "Close position" }));
    await waitFor(() => expect(ordersPosted).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(positionRequests).toBe(before);
    expect(screen.getByText("SOL-USD")).toBeInTheDocument();
  });

  it("keeps the position and shows the engine's own words when the close is refused", async () => {
    orderOutcome = "fail";
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Close position" }));

    // Verbatim: "There are no matches available" tells the user something true
    // and actionable in a way a generic failure line does not.
    expect(
      await screen.findByText(/There are no matches available/),
    ).toBeInTheDocument();
    // The position is untouched — the row is still there, and still closeable.
    expect(screen.getByText("SOL-USD")).toBeInTheDocument();
  });

  /**
   * D11, fixed in Phase 14.
   *
   * The refusal used to be a toast, and the toast viewport lives at the app
   * root — outside the dialog, which Radix marks `aria-hidden` while it is
   * open. So the engine's own words were painted and readable and completely
   * absent from the accessibility tree, on the one action in this app that
   * realises money. `toBeVisible` cannot catch that (the toast IS visible);
   * containment in the dialog node is the property that actually matters, so
   * that is what is asserted.
   */
  it("puts the refusal INSIDE the dialog, where a screen reader can reach it", async () => {
    orderOutcome = "fail";
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Close position" }));

    const message = await screen.findByText(/There are no matches available/);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(message);
    // And the dialog is still open, so "try again" is the button under the
    // cursor rather than a row action the user has to find again.
    expect(
      screen.getByRole("button", { name: "Close position" }),
    ).toBeInTheDocument();
  });

  /**
   * An engine timeout is not a refusal, and saying "Could not close position"
   * for one would be a claim the client cannot make: `POST /order` reached the
   * backend, which pushed it onto the stream — the close may be executing right
   * now. Retrying on that assumption flattens the position twice.
   */
  it("says a close is NOT CONFIRMED when the engine stops answering", async () => {
    orderOutcome = "engine-down";
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Close position" }));

    const heading = await screen.findByText(/close not confirmed/i);
    expect(screen.getByRole("dialog")).toContainElement(heading);
    expect(
      screen.getByText(/may still have gone through/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not close position/i)).toBeNull();
  });
});
