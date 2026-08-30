import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Phase 8's gate: the Open-orders tab is this account's real resting orders,
 * and Cancel works for the owner only, without corrupting the book.
 *
 * G27 (the tab must not list terminal orders) and G5 (cancel authorisation,
 * fixed in Phase 1) are proved here rather than only in unit tests, because both
 * are about what one account can see or do to another. G26 is NOT provable from
 * here — see the note on the depth assertion below.
 *
 * This suite requires **db-writer** to be running. It is what applies the
 * engine's `order_updates`, and since Phase 8 `/orders/open` returns only `open`
 * and `partially_filled` rows — without db-writer every order stays `pending` in
 * Postgres and the tab is empty however the order actually ended.
 *
 * The engine's book is in-memory and shared by every spec in this run, so each
 * test prices its orders where nothing else trades and asserts on rows it can
 * identify by id.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const PASSWORD = "pw123456";

async function fundedAccount(page: Page, deposit: string) {
  const username = `e2e-oo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Trader");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trade\/SOL-USD/);

  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill(deposit);
  await page.getByRole("button", { name: /^Deposit \$/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  return username;
}

async function marketIdFor(request: APIRequestContext, slug: string) {
  const res = await request.get(`${API}/markets`);
  const { markets } = (await res.json()) as {
    markets: { id: string; slug: string }[];
  };
  return markets.find((m) => m.slug === slug)!.id;
}

/** Fills the ticket and drives it through the confirm dialog. */
async function placeOrder(page: Page, opts: { price: string; qty: string }) {
  await page.getByLabel("Limit price").fill(opts.price);
  await page.getByLabel("Quantity").fill(opts.qty);
  await page.getByRole("button", { name: /^Buy /, exact: false }).first().click();
  await page.getByRole("button", { name: /^Confirm buy/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

const ordersTab = (page: Page) =>
  page.getByRole("tab", { name: /Open orders/ });

async function openOrdersPanel(page: Page) {
  await ordersTab(page).click();
  return page.getByRole("tabpanel");
}

const depthFor = async (page: Page, marketId: string) => {
  const res = await page.request.get(`${API}/depth?marketId=${marketId}`);
  return (await res.json()) as { bids: [string, string][] };
};

/**
 * A bid price with nothing already resting on it.
 *
 * The engine's book is in-memory, shared by every spec in the run, and outlives
 * the run in a snapshot. "The level is gone after the cancel" is only a
 * statement about OUR order if our order was the only thing on that level, so
 * the price is chosen against the live ladder rather than hardcoded — an earlier
 * version of this test hardcoded 3 and failed the second time it ran.
 */
async function freeBidPrice(page: Page, marketId: string) {
  const { bids } = await depthFor(page, marketId);
  const taken = new Set(bids.map(([price]) => Number(price)));
  const bestBid = bids.length ? Math.max(...bids.map(([p]) => Number(p))) : 4;

  /**
   * DOWNWARD from the best bid, not upward from a dollar.
   *
   * `getMarketDepth` returns at most 20 levels a side (`maxDepth = 20`). This
   * scanned up from 1.01, and once the suite had left more than 20 bid levels
   * behind, every level it could find was BELOW the window `GET /depth` shows —
   * so the order rested correctly and the assertion "our level is on the book"
   * failed against a snapshot that structurally could not contain it. Searching
   * down from the touch keeps the level both free and visible, and still under
   * the best bid so it cannot cross.
   */
  for (let cents = Math.round(bestBid * 100) - 1; cents >= 100; cents--) {
    const price = cents / 100;
    if (!taken.has(price)) return price.toFixed(2);
  }
  throw new Error(`no free bid level under ${bestBid} — is the book seeded?`);
}

const availableFor = async (page: Page) => {
  const res = await page.request.get(`${API}/equity/balances`);
  const { balances } = (await res.json()) as {
    balances: { available: string | number };
  };
  return Number(balances.available);
};

test("a resting order appears in the tab, and cancelling it releases its margin", async ({
  page,
  request,
}) => {
  await fundedAccount(page, "5000");
  const marketId = await marketIdFor(request, "SOL-USD");

  // Priced far under the market so it cannot cross, and on a level nothing else
  // is resting on, so the depth assertions below are about this order alone.
  const price = await freeBidPrice(page, marketId);
  await placeOrder(page, { price, qty: "10" });
  await expect(
    page.getByRole("region", { name: /notifications/i }).getByText("Order placed"),
  ).toBeVisible();

  const beforeAvailable = await availableFor(page);

  const panel = await openOrdersPanel(page);
  const row = panel.getByRole("row").filter({ hasText: "SOL-USD" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("open");

  // On the book before the cancel, and holding exactly our quantity — which is
  // also what makes the level ours to reason about.
  const before = await depthFor(page, marketId);
  expect(before.bids.find(([p]) => Number(p) === Number(price))).toEqual([
    `${Number(price)}`,
    "10",
  ]);

  await row.getByRole("button", { name: "Cancel" }).click();

  // Optimistic in the UI, and then true on the server.
  await expect(panel.getByRole("row").filter({ hasText: "SOL-USD" })).toHaveCount(
    0,
  );

  await expect
    .poll(async () => {
      const res = await page.request.get(`${API}/orders/open/${marketId}`);
      const { orders } = (await res.json()) as { orders: unknown[] };
      return orders.length;
    })
    .toBe(0);

  // Margin comes back: the order was holding price * qty at 1x.
  await expect.poll(() => availableFor(page)).toBeGreaterThan(beforeAvailable);

  /**
   * The acceptance criterion: after a cancel the ladder matches the engine's
   * book exactly.
   *
   * This is NOT the G26 regression test, and the difference was worth finding
   * out the hard way — this test passes with the old `delete orderbook.asks[…]`
   * still in place. `getMarketDepth` walks the book through
   * `getNextBestBidPrice`, which skips any level with `availableQty <= 0`, so
   * the emptied bid level G26 leaves behind is invisible from here. The
   * regression is pinned in `exchange-engine.test.ts`, against the store itself.
   */
  const after = await depthFor(page, marketId);
  expect(after.bids.some(([p]) => Number(p) === Number(price))).toBe(false);
});

test("a filled order never shows up as an open one", async ({
  page,
  request,
}) => {
  /**
   * G27. `getOpenOrdersForMarket` filtered out only `cancelled`, so every order
   * the account had ever filled in the market came back — each row carrying a
   * Cancel button the engine answers with "Order not found".
   */
  const maker = request;
  const makerName = `e2e-oo-maker-${Date.now()}`;
  await maker.post(`${API}/signup`, {
    data: { username: makerName, password: PASSWORD, name: "Maker" },
  });
  await maker.post(`${API}/onramp`, { data: { amount: 100000 } });
  const ask = await maker.post(`${API}/order`, {
    data: {
      orderType: "limit",
      market: "SOL-USD",
      type: "SHORT",
      price: 150,
      slippage: 0,
      qty: 2,
      equity: 300,
    },
  });
  expect(ask.ok()).toBeTruthy();

  await fundedAccount(page, "5000");
  // Crosses the ask above, so it fills outright and rests nothing.
  await placeOrder(page, { price: "500", qty: "1" });
  await expect(
    page.getByRole("region", { name: /notifications/i }).getByText("Filled", {
      exact: true,
    }),
  ).toBeVisible();

  const marketId = await marketIdFor(request, "SOL-USD");
  const res = await page.request.get(`${API}/orders/open/${marketId}`);
  const { orders } = (await res.json()) as { orders: { status: string }[] };
  expect(orders.every((o) => o.status === "open" || o.status === "partially_filled")).toBe(
    true,
  );

  const panel = await openOrdersPanel(page);
  await expect(panel.getByText("No open orders")).toBeVisible();
});

test("one account cannot cancel another's order", async ({ page, request }) => {
  /**
   * The G5 gate. `cancelOrder` used to look the row up by id alone, so any
   * authenticated user could cancel anyone's resting order by knowing its id.
   * A 404 rather than a 403 is deliberate: a 403 confirms the id is real.
   */
  await fundedAccount(page, "5000");
  await placeOrder(page, { price: "4", qty: "5" });

  const marketId = await marketIdFor(request, "SOL-USD");
  const mine = await page.request.get(`${API}/orders/open/${marketId}`);
  const { orders } = (await mine.json()) as { orders: { id: string; price: string }[] };
  const victim = orders.find((o) => Number(o.price) === 4)!;
  expect(victim).toBeDefined();

  // A second account, on its own cookie jar.
  const attackerName = `e2e-oo-attacker-${Date.now()}`;
  await request.post(`${API}/signup`, {
    data: { username: attackerName, password: PASSWORD, name: "Mallory" },
  });
  const attempt = await request.delete(`${API}/order/${victim.id}`);
  expect(attempt.status()).toBe(404);

  // And the order is still resting, untouched.
  const after = await page.request.get(`${API}/orders/open/${marketId}`);
  const { orders: still } = (await after.json()) as {
    orders: { id: string }[];
  };
  expect(still.some((o) => o.id === victim.id)).toBe(true);
});
