import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

/**
 * The order ticket's submit path.
 *
 * Every outcome shown to the user has to come from the engine's reply. The
 * ticket used to invent one — a 450ms sleep and a hardcoded "filled" for market
 * orders — so these tests are specifically about the four real outcomes and the
 * one thing that must never happen twice.
 *
 * `fetch` is stubbed rather than `@/lib/api/endpoints` module-mocked: bun's
 * `mock.module` is process-global and leaks into every other file in the run.
 * Stubbing the transport keeps the real module graph, so the payload is
 * genuinely validated against `CreateOrderSchema` on its way out.
 */

mock.module("next/navigation", () => ({
  useRouter: () => ({
    replace: () => undefined,
    push: () => undefined,
    refresh: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

type OrderReply =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

let orderReply: OrderReply = {
  ok: true,
  body: {
    orderId: "3f4b1e2c-0000-4000-8000-000000000001",
    status: "filled",
    filledQty: 2,
    totalPrice: 410.8,
    // Deliberately NOT the 200 the ticket submitted: the toast must print what
    // executed, never what was asked for.
    averagePrice: 205.4,
    fills: [],
  },
};

/** Set to hold the POST open so the in-flight UI can be inspected. */
let releaseOrder: (() => void) | null = null;
let orderBodies: unknown[] = [];
let balanceCalls = 0;
let openOrderCalls = 0;

const realFetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);

  if (url.endsWith("/me")) {
    return json({ userId: "u-1", username: "alice" });
  }
  if (url.includes("/equity/balances")) {
    balanceCalls += 1;
    return json({ balances: { available: "10000", locked: "0" } });
  }
  if (url.includes("/orders/open/")) {
    openOrderCalls += 1;
    return json({ orders: [] });
  }
  if (url.includes("/positions/open/")) {
    return json({ positions: [] });
  }
  if (url.endsWith("/order")) {
    orderBodies.push(JSON.parse(String(init?.body ?? "null")));
    if (releaseOrder) {
      await new Promise<void>((resolve) => {
        releaseOrder = resolve;
      });
    }
    return orderReply.ok
      ? json(orderReply.body)
      : json(orderReply.body, orderReply.status);
  }
  return json({}, 404);
}) as unknown as typeof fetch;

const { SessionProvider } = await import("@/lib/auth/session-provider");
const { AccountProvider } = await import("@/lib/account");
const { OrdersProvider } = await import("@/lib/orders");
const { PositionsProvider } = await import("@/lib/positions");
const { MARKETS } = await import("@/lib/markets");
const { ToastProvider } = await import("@/components/ui/toast");
const { TooltipProvider } = await import("@/components/ui/tooltip");
const { OrderForm } = await import("./order-form");
const { DEFAULT_MARKET } = await import("@/lib/markets");

function Ticket({
  lastPrice = 200,
  bestBid,
  bestAsk,
}: {
  lastPrice?: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
} = {}) {
  const [price, setPrice] = useState("200");
  return (
    <SessionProvider>
      <AccountProvider>
        {/* Both providers are above the ticket here exactly as they are in
            the terminal. The ticket no longer refreshes either of them — the
            private channel does — but the tree is the one the component runs
            in, and two of the assertions below are that no request was made. */}
        <OrdersProvider markets={MARKETS}>
          <PositionsProvider markets={MARKETS}>
            <ToastProvider>
              <TooltipProvider>
                <OrderForm
                  market={DEFAULT_MARKET}
                  lastPrice={lastPrice}
                  bestBid={bestBid}
                  bestAsk={bestAsk}
                  price={price}
                  onPriceChange={setPrice}
                />
              </TooltipProvider>
            </ToastProvider>
          </PositionsProvider>
        </OrdersProvider>
      </AccountProvider>
    </SessionProvider>
  );
}

/** Renders and waits for the real balance, which the ticket validates against. */
async function openTicket(props?: {
  lastPrice?: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
}) {
  render(<Ticket {...props} />);
  await screen.findByText("$10,000.00");
}

const setQty = (value: string) =>
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value },
  });

const confirmButton = () =>
  screen.getByRole("button", { name: /confirm buy|confirm sell/i });

async function submit(qty = "2") {
  setQty(qty);
  fireEvent.click(screen.getByRole("button", { name: /^Buy 2 SOL$|^Buy/ }));
  await waitFor(() => expect(confirmButton()).toBeInTheDocument());
  fireEvent.click(confirmButton());
}

beforeEach(() => {
  orderBodies = [];
  balanceCalls = 0;
  openOrderCalls = 0;
  releaseOrder = null;
});

afterEach(() => {
  orderReply = {
    ok: true,
    body: {
      orderId: "3f4b1e2c-0000-4000-8000-000000000001",
      status: "filled",
      filledQty: 2,
      totalPrice: 410.8,
      averagePrice: 205.4,
      fills: [],
    },
  };
});

describe("submitting an order", () => {
  it("reports a full fill at the executed average price", async () => {
    await openTicket();
    await submit("2");

    await screen.findByText("Filled");
    // The average from the reply, not the 200 the ticket asked for.
    expect(await screen.findByText("205.40")).toBeInTheDocument();
  });

  it("does NOT refetch the open-orders list after submitting", async () => {
    // Phase 13 inverted this assertion. The ticket used to re-read every
    // market's open orders after a submit, because nothing else would tell the
    // table that an order had rested or that a crossing one had consumed
    // somebody's liquidity. The engine now publishes both as `order.new` and
    // `order.update` on the private channel and `OrdersProvider` applies them,
    // so a refetch here would be three requests that change nothing — and
    // would hide a reducer bug behind a list that happened to be re-read.
    await openTicket();
    const onMount = openOrderCalls;
    await submit("2");
    await screen.findByText("Filled");
    // Deliberately asserted against the request log rather than the UI: a
    // table that looks right because it was refetched looks identical to one
    // that is right because the reducer worked.
    await waitFor(() => expect(screen.getByText("Filled")).toBeInTheDocument());
    expect(openOrderCalls).toBe(onMount);
  });

  it("reports a partial fill as partial, with the quantity that filled", async () => {
    orderReply = {
      ok: true,
      body: {
        orderId: "3f4b1e2c-0000-4000-8000-000000000002",
        status: "partially_filled",
        filledQty: 0.5,
        totalPrice: 100,
        averagePrice: 200,
        fills: [],
      },
    };
    await openTicket();
    await submit("2");

    await screen.findByText("Partially filled");
    expect(await screen.findByText(/0\.50 SOL/)).toBeInTheDocument();
  });

  it("reports a resting limit order rather than claiming a fill", async () => {
    orderReply = {
      ok: true,
      body: {
        orderId: "3f4b1e2c-0000-4000-8000-000000000003",
        status: "open",
        filledQty: 0,
        totalPrice: 0,
        averagePrice: 0,
        fills: [],
      },
    };
    await openTicket();
    await submit("2");

    await screen.findByText("Order placed");
  });

  it("shows the engine's own rejection reason, in the toast and on the form", async () => {
    orderReply = {
      ok: false,
      status: 400,
      body: {
        code: "INVALID_REQUEST",
        message: "User does not have available margin",
      },
    };
    await openTicket();
    await submit("2");

    await screen.findByText("Rejected");
    // Once in the toast, once as the field error under Quantity.
    await waitFor(() =>
      expect(
        screen.getAllByText(/User does not have available margin/).length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  /**
   * An engine timeout is not a rejection, and the ticket must not call it one.
   *
   * `POST /order` inserts the row and pushes it onto the Redis stream before
   * the engine ever sees it, so a 503 `ENGINE_TIMEOUT` means the order may be
   * resting — or filling — right now. "Rejected" is a claim the client was
   * never given, and the obvious response to a rejection is to place the order
   * again, which is how one order becomes two.
   */
  it("says NOT CONFIRMED, not rejected, when the engine stops answering", async () => {
    orderReply = {
      ok: false,
      status: 503,
      body: {
        code: "ENGINE_TIMEOUT",
        message: "The matching engine is not responding",
      },
    };
    await openTicket();
    await submit("2");

    await screen.findByText("Not confirmed");
    expect(screen.queryByText("Rejected")).toBeNull();
    // And it says where the answer will actually appear.
    await waitFor(() =>
      expect(
        screen.getAllByText(/Check Open orders before placing it again/).length,
      ).toBeGreaterThanOrEqual(1),
    );
  });

  it("keeps an infrastructure failure off the Quantity field", async () => {
    /**
     * The rejection above lands on the Quantity input on purpose: every reason
     * the ENGINE gives is answered by changing the size or the price. "The
     * matching engine is not responding" is answered by neither, and an error
     * on that input would send the user to edit a number that was never wrong.
     * §7.4 routes infrastructure failures to a panel-level message instead.
     */
    orderReply = {
      ok: false,
      status: 503,
      body: {
        code: "ENGINE_TIMEOUT",
        message: "The matching engine is not responding",
      },
    };
    await openTicket();
    await submit("2");

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent(/matching engine is not responding/i);

    const quantity = screen.getByLabelText(/quantity/i);
    expect(quantity).not.toHaveAttribute("aria-invalid", "true");
  });

  it("sends the wire payload the schema describes", async () => {
    await openTicket();
    await submit("2");

    await waitFor(() => expect(orderBodies).toHaveLength(1));
    expect(orderBodies[0]).toMatchObject({
      orderType: "limit",
      market: "SOL-USD",
      type: "LONG",
      price: 200,
      slippage: 0,
      qty: 2,
    });
  });

  it("does NOT re-read balances after submitting", async () => {
    // Same inversion as the open-orders assertion above. The engine ends every
    // reply that moves money with an absolute `balance` event, so the one
    // request on mount is the snapshot and there is nothing to ask again for.
    await openTicket();
    expect(balanceCalls).toBe(1);
    await submit("2");
    await screen.findByText("Filled");
    expect(balanceCalls).toBe(1);
  });
});

describe("the double-submit guard (G24)", () => {
  it("disables confirm for the whole request and sends exactly one order", async () => {
    // `POST /order` is not idempotent — the correlation id is minted after the
    // row is inserted — so a second click is a second position.
    releaseOrder = () => undefined;
    await openTicket();
    await submit("2");

    await waitFor(() => expect(confirmButton()).toBeDisabled());
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(releaseOrder).not.toBeNull());
    releaseOrder?.();

    await screen.findByText("Filled");
    expect(orderBodies).toHaveLength(1);
  });
});

/**
 * Sizing a market order once the feed can legitimately have no price.
 *
 * Before Phase 11 the simulator guaranteed a `lastPrice` for every market, so
 * the ticket could size a market order off the last trade and never meet the
 * null. A real feed has no such guarantee: a market that has not traded since
 * the engine started has no last price, ever, and the book is the better basis
 * regardless — a market buy lifts the best ask, not whatever last printed.
 */
describe("sizing a market order", () => {
  const marketMode = () =>
    fireEvent.click(screen.getByRole("radio", { name: "Market" }));

  it("sizes a buy off the best ask, not the last trade", async () => {
    await openTicket({ lastPrice: 200, bestBid: 100, bestAsk: 300 });
    marketMode();
    setQty("2");

    // 2 × 300 at 5x leverage. Off the last trade it would read $80.00.
    await waitFor(() => expect(screen.getByText("$120.00")).toBeInTheDocument());
  });

  it("falls back to the far side of the book, then to the last trade", async () => {
    await openTicket({ lastPrice: 200, bestBid: 100, bestAsk: null });
    marketMode();
    setQty("2");
    await waitFor(() => expect(screen.getByText("$40.00")).toBeInTheDocument());

    cleanup();
    await openTicket({ lastPrice: 200, bestBid: null, bestAsk: null });
    marketMode();
    setQty("2");
    await waitFor(() => expect(screen.getByText("$80.00")).toBeInTheDocument());
  });

  it("says why it cannot submit when the market has no price at all", async () => {
    // The old failure mode was a disabled button and no explanation, which is
    // the one outcome worse than refusing.
    await openTicket({ lastPrice: null, bestBid: null, bestAsk: null });
    marketMode();
    setQty("2");

    await waitFor(() =>
      expect(
        screen.getByText(/No price for this market yet/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Buy/ })).toBeDisabled();
  });
});
