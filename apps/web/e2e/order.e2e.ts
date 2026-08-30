import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

/**
 * Phase 7's gate: the ticket submits to the matching engine and reports what
 * actually happened.
 *
 * `POST /order` is synchronous through the engine, so every outcome asserted
 * here comes back in the HTTP response the ticket already awaits — nothing in
 * this file waits on a WebSocket, and nothing should.
 *
 * The engine's book is in-memory and shared by every spec in this run, so these
 * tests are written to be indifferent to what is already resting: a limit order
 * priced far from the market rests whatever else is there, a market order fills
 * against whatever the best price is, and the empty-book case uses BTC, which
 * no other spec touches.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const PASSWORD = "pw123456";

/** A signed-in account with collateral, created through the UI. */
async function fundedAccount(page: Page, deposit: string) {
  const username = `e2e-ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Trader");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trade\/SOL-USD/);

  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill(deposit);
  // Matched loosely: the button prints the amount formatted, so "5000" reads
  // back as "$5,000.00".
  await page.getByRole("button", { name: /^Deposit \$/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  return username;
}

/**
 * A second trader, driven entirely over HTTP.
 *
 * A maker has nothing to look at — the resting order it leaves behind is the
 * whole contribution — and a second browser context to place one would double
 * the runtime of this spec for no coverage.
 */
async function makerAccount(request: APIRequestContext) {
  const api = request;
  const username = `e2e-maker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const signup = await api.post(`${API}/signup`, {
    data: { username, password: PASSWORD, name: "Maker" },
  });
  expect(signup.ok()).toBeTruthy();
  const onramp = await api.post(`${API}/onramp`, { data: { amount: 100000 } });
  expect(onramp.ok()).toBeTruthy();
  return api;
}

async function marketIdFor(request: APIRequestContext, slug: string) {
  const res = await request.get(`${API}/markets`);
  const { markets } = (await res.json()) as {
    markets: { id: string; slug: string }[];
  };
  return markets.find((m) => m.slug === slug)!.id;
}

/**
 * A bid price on BTC that is free, and low enough not to become a fill target.
 *
 * Read off the live book rather than chosen: this suite runs repeatedly against
 * one in-memory engine, so a hardcoded level is somebody else's resting order by
 * the second run.
 */
async function freeBtcBid(ctx: APIRequestContext, marketId: string) {
  const res = await ctx.get(`${API}/depth?marketId=${marketId}`);
  const { bids } = (await res.json()) as { bids: [string, string][] };
  const taken = new Set(bids.map(([p]) => Number(p)));
  for (let price = 100; ; price++) if (!taken.has(price)) return price;
}

/** The toast stack, scoped.
 *
 * Bare `getByText` is not safe here: the toast system also renders an
 * `aria-live` announcer holding the same words for screen readers, so an
 * unscoped matcher intermittently resolves to two elements.
 */
const toasts = (page: Page) =>
  page.getByRole("region", { name: /notifications/i });

/** The ticket's own field-level error, under Quantity. */
const fieldError = (page: Page) => page.locator('p[role="alert"]');

/** Fills the ticket and drives it through the confirm dialog. */
async function placeOrder(
  page: Page,
  opts: { type?: "limit" | "market"; price?: string; qty: string },
) {
  if (opts.type === "market") {
    await page.getByRole("radio", { name: "Market" }).click();
  }
  if (opts.price) {
    await page.getByLabel("Limit price").fill(opts.price);
  }
  await page.getByLabel("Quantity").fill(opts.qty);
  await page.getByRole("button", { name: /^Buy /, exact: false }).first().click();
  await page.getByRole("button", { name: /^Confirm buy/ }).click();
}

test("a limit order away from the market rests, and the engine knows about it", async ({
  page,
  request,
}) => {
  await fundedAccount(page, "5000");

  // Deliberately far below anything the book can hold, so this cannot cross
  // whatever earlier specs left behind: it rests, every time.
  await placeOrder(page, { price: "1", qty: "10" });

  // "Order placed", not "Filled" — the ticket used to claim a fill for every
  // submission because the outcome was invented locally.
  await expect(toasts(page).getByText("Order placed")).toBeVisible();
  await expect(toasts(page).getByText("Filled", { exact: true })).toHaveCount(0);

  const marketId = await marketIdFor(request, "SOL-USD");
  const res = await page.request.get(`${API}/orders/open/${marketId}`);
  const { orders } = (await res.json()) as {
    orders: { price: string; qty: string; status: string }[];
  };
  const resting = orders.find((o) => o.price === "1");
  expect(resting).toBeDefined();
  expect(resting!.status).not.toBe("cancelled");
});

test("a crossing limit order reports a real fill at the price it executed", async ({
  page,
  request,
}) => {
  const maker = await makerAccount(request);
  const ask = await maker.post(`${API}/order`, {
    data: {
      orderType: "limit",
      market: "SOL-USD",
      type: "SHORT",
      price: 150,
      slippage: 0,
      qty: 5,
      equity: 750,
    },
  });
  expect(ask.ok()).toBeTruthy();

  await fundedAccount(page, "5000");

  // Priced above everything resting, so it crosses whatever the best ask is.
  await placeOrder(page, { price: "500", qty: "1" });

  await expect(toasts(page).getByText("Filled", { exact: true })).toBeVisible();

  // G29: the toast prints the executed average, never the price submitted. A
  // limit buy at 500 that crossed an ask at 150 did not trade at 500.
  await expect(toasts(page).getByText("500.00")).toHaveCount(0);

  // And a fill is a position, not just a message.
  const marketId = await marketIdFor(request, "SOL-USD");
  const res = await page.request.get(`${API}/positions/open/${marketId}`);
  const { positions } = (await res.json()) as {
    positions: { type: string; qty: string | number }[];
  };
  expect(positions.some((p) => p.type === "LONG")).toBe(true);
});

test("a market order fills against the resting book", async ({ page, request }) => {
  // The path that could not pass until the engine stopped assigning the
  // slippage percent to `price`: a long market order could reach no ask above
  // $1, so it came back cancelled with the margin already locked.
  const maker = await makerAccount(request);
  const ask = await maker.post(`${API}/order`, {
    data: {
      orderType: "limit",
      market: "SOL-USD",
      type: "SHORT",
      price: 150,
      slippage: 0,
      qty: 5,
      equity: 750,
    },
  });
  expect(ask.ok()).toBeTruthy();

  await fundedAccount(page, "5000");
  await placeOrder(page, { type: "market", qty: "1" });

  await expect(toasts(page).getByText("Filled", { exact: true })).toBeVisible();

  const marketId = await marketIdFor(request, "SOL-USD");
  const res = await page.request.get(`${API}/positions/open/${marketId}`);
  const { positions } = (await res.json()) as { positions: { type: string }[] };
  expect(positions.some((p) => p.type === "LONG")).toBe(true);
});

test("a rejected order shows the engine's own reason and leaves no pending row", async ({
  page,
  request,
}) => {
  /**
   * A bid on BTC, and nothing on the ask side.
   *
   * BTC's book is untouched by every other spec, so a market BUY there has
   * nothing to match and the engine refuses it outright — that is the whole
   * point of this test. The bid is here for a Phase 11 reason: a market order
   * has no price of its own, so the ticket sizes its margin from the book, and
   * a market with an entirely empty book and no trade history has no basis to
   * size from. It used to have one because the feed was simulated and invented
   * a price for every market. Now the ticket says so and refuses to submit —
   * correctly — so this spec has to quote one side to get as far as the engine.
   */
  const maker = await makerAccount(request);
  const btcId = await marketIdFor(request, "BTC-USD");
  const bid = await freeBtcBid(request, btcId);
  const rested = await maker.post(`${API}/order`, {
    data: {
      orderType: "limit",
      market: "BTC-USD",
      type: "LONG",
      price: bid,
      slippage: 0,
      qty: 0.01,
      equity: bid * 0.01,
    },
  });
  expect(rested.ok()).toBeTruthy();

  await fundedAccount(page, "5000");

  await page.goto("/trade/BTC-USD");
  await placeOrder(page, { type: "market", qty: "0.01" });

  // The engine's own words, in both places the user might look.
  await expect(toasts(page).getByText("Rejected")).toBeVisible();
  await expect(
    toasts(page).getByText(/There are no matches available/),
  ).toBeVisible();
  await expect(fieldError(page)).toHaveText(/There are no matches available/);

  // G28: the row the backend inserted before calling the engine must not still
  // be `pending`, or it shows up in Open orders as a live, uncancellable order.
  const marketId = await marketIdFor(request, "BTC-USD");
  const res = await page.request.get(`${API}/orders/${marketId}`);
  const { orders } = (await res.json()) as { orders: { status: string }[] };
  expect(orders.length).toBeGreaterThan(0);
  expect(orders.every((o) => o.status !== "pending")).toBe(true);
});

test("an order the client mis-sizes is refused by the engine, in its words", async ({
  page,
}) => {
  await fundedAccount(page, "100");

  // The ticket blocks an over-sized order before it is sent, so the only way to
  // exercise the server's own margin check is to corrupt the request in flight.
  // What is under test is the reporting, not the arithmetic that prevented it.
  await page.route(`${API}/order`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.continue({
      postData: JSON.stringify({ ...body, equity: 999999 }),
    });
  });

  await placeOrder(page, { price: "1", qty: "10" });

  await expect(toasts(page).getByText("Rejected")).toBeVisible();
  await expect(
    toasts(page).getByText(/User does not have available margin/),
  ).toBeVisible();
  await expect(fieldError(page)).toHaveText(/User does not have available margin/);
});
