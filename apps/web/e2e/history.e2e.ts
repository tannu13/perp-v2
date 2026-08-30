import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Phase 10's gate: the two historical tabs are this account's real trades, and
 * the side each row shows is the side THIS account was on.
 *
 * The assertion that matters is the per-viewer one. A `fills` row records a
 * trade, not a participant — one maker, one taker, no direction — so the same
 * row has to read SHORT/maker to one account and LONG/taker to the other. A
 * derivation that read the wrong order would be invisible in a single-account
 * test and would tell every user they bought when they sold.
 *
 * Requires **db-writer**, like the Phase 8 and 9 suites: it is what applies the
 * engine's `order_updates`, and without it a filled order stays `pending` in
 * Postgres, which is neither open nor historical, so both tabs come back empty.
 * It is also why nothing here reads `/fills` straight after a toast — see
 * `waitForFillAt`.
 *
 * **Every price is chosen against the live book, never hardcoded.** The engine's
 * orderbook is in memory, shared by every spec in the run, and restored from a
 * snapshot on boot — so a price that was empty on the first run has this suite's
 * own leftovers resting on it by the second. The first version of this file
 * hardcoded 720/721/722 and passed exactly once.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const PASSWORD = "pw123456";

async function fundedAccount(page: Page, deposit: string) {
  const username = `e2e-h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

async function depthFor(ctx: APIRequestContext, marketId: string) {
  const res = await ctx.get(`${API}/depth?marketId=${marketId}`);
  const { bids, asks } = (await res.json()) as {
    bids: [string, string][];
    asks: [string, string][];
  };
  const prices = (side: [string, string][]) => side.map(([p]) => Number(p));
  return {
    taken: new Set([...prices(bids), ...prices(asks)]),
    bestBid: bids.length ? Math.max(...prices(bids)) : 1,
    bestAsk: asks.length ? Math.min(...prices(asks)) : Infinity,
  };
}

/**
 * A price for the maker's ask: free, and the BEST ask once it is there.
 *
 * Three constraints, and each of them cost a run to learn.
 *
 * - **Free**, or the maker joins a level somebody else is already resting on
 *   and the taker's buy fills against a stranger's order — which makes the
 *   per-viewer assertion meaningless without failing loudly.
 * - **The best ask**, i.e. just above the best bid rather than just below the
 *   existing best ask. A limit buy takes the cheapest ask available, not the
 *   one at its own limit, so an ask placed above an existing one never trades.
 * - **Near the touch**, because a market order's slippage band is computed from
 *   the market price. An ask 600 dollars up is unreachable by the market order
 *   the last test places, however generous the limit.
 *
 * Searched in CENTS, not dollars. Once this suite has run once the spread can
 * be under a dollar wide — the first version stepped in whole dollars and had
 * no candidate at all on its second run.
 *
 * Every test below also rests exactly the quantity it is about to take, so the
 * level is consumed and the touch ends where it started. A maker order left
 * half filled would become the new best ask and close the gap this needs.
 */
async function freeAskPrice(ctx: APIRequestContext, marketId: string) {
  const { taken, bestBid, bestAsk } = await depthFor(ctx, marketId);
  const limit = Number.isFinite(bestAsk) ? bestAsk : bestBid + 100;
  for (let cents = Math.floor(bestBid * 100) + 1; cents / 100 < limit; cents++) {
    const price = cents / 100;
    if (!taken.has(price)) return price;
  }
  throw new Error(`no free ask level between ${bestBid} and ${bestAsk}`);
}

/**
 * A price for an order that must REST rather than trade: free, and under the
 * best bid so it cannot cross and cannot move the touch for the next test.
 */
async function freeRestingBidPrice(ctx: APIRequestContext, marketId: string) {
  const { taken, bestBid, bestAsk } = await depthFor(ctx, marketId);
  /**
   * Under the best bid when there is one, so the touch does not move. When the
   * bid side is empty — which is the engine's state after a restart from its
   * snapshot — anything under the best ask will do, and the lowest free level
   * is the one that leaves the most room for `freeAskPrice` afterwards.
   */
  const ceiling = bestBid > 1 ? bestBid : Math.min(bestAsk, 100);
  /**
   * In CENTS, and DOWNWARD from the ceiling. This order is never filled, so its
   * level is still occupied on the next run — search whole dollars only and the
   * suite runs out of levels after a handful of runs, which is how this first
   * failed. Searching *up* from a dollar has the same shape of bug one level
   * deeper: `GET /depth` shows 20 levels a side, so once the suite has left
   * more than 20 bids behind, everything found down there is outside the
   * snapshot the assertions read.
   */
  for (let cents = Math.round(ceiling * 100) - 1; cents >= 100; cents--) {
    const price = cents / 100;
    if (!taken.has(price)) return price;
  }
  throw new Error(`no free bid level under ${ceiling}`);
}

/** A funded account on its own cookie jar, driven over the API only. */
async function apiAccount(request: APIRequestContext, tag: string) {
  const username = `e2e-h-${tag}-${Date.now()}`;
  await request.post(`${API}/signup`, {
    data: { username, password: PASSWORD, name: tag },
  });
  await request.post(`${API}/onramp`, { data: { amount: 400000 } });
  return username;
}

/** Rests a SHORT at `price` for the counterparty to lift. */
async function restingAsk(
  request: APIRequestContext,
  price: number,
  qty: number,
) {
  const res = await request.post(`${API}/order`, {
    data: {
      orderType: "limit",
      market: "SOL-USD",
      type: "SHORT",
      price,
      slippage: 0,
      qty,
      equity: price * qty,
    },
  });
  expect(res.ok()).toBeTruthy();
  return res;
}

async function fillsFor(ctx: APIRequestContext, query = "") {
  const res = await ctx.get(`${API}/fills${query}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as {
    fills: {
      id: string;
      marketSlug: string;
      side: "LONG" | "SHORT";
      role: "maker" | "taker";
      price: string;
      qty: string;
      orderId: string;
    }[];
    nextCursor: string | null;
  };
}

/**
 * Waits until db-writer has actually written the fills.
 *
 * Both historical tabs read POSTGRES, which is downstream of the engine through
 * db-writer's stream consumer. The "Filled" toast is the ENGINE's answer,
 * returned synchronously on the order request — the `fills` rows land some
 * milliseconds later. Asserting on `/fills` straight after the toast is a race
 * this suite lost on its first run, and it is a race the product has too: it is
 * why both tabs refetch on activation rather than trusting what they had.
 */
async function waitForFillAt(ctx: APIRequestContext, price: number) {
  await expect
    .poll(
      async () => {
        const { fills } = await fillsFor(ctx);
        return fills.filter((f) => Number(f.price) === price).length;
      },
      { message: `no fill at ${price} — is db-writer running?` },
    )
    .toBeGreaterThan(0);
}

/** Fills the ticket and drives it through the confirm dialog. */
async function placeOrder(
  page: Page,
  opts: { type?: "limit" | "market"; price?: string; qty: string },
) {
  // A radio in a SegmentedControl. The only `tab`s on this screen belong to the
  // account panel below.
  if (opts.type === "market") {
    await page.getByRole("radio", { name: "Market" }).click();
  }
  if (opts.price) {
    await page.getByLabel("Limit price").fill(opts.price);
  }
  await page.getByLabel("Quantity").fill(opts.qty);
  await page
    .getByRole("button", { name: /^Buy /, exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: /^Confirm buy/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

const openPanel = async (page: Page, tab: RegExp) => {
  await page.getByRole("tab", { name: tab }).click();
  return page.getByRole("tabpanel");
};

/**
 * Body rows only.
 *
 * `getByRole("row")` includes the header, and Playwright's `hasText` is a
 * case-insensitive substring — so filtering for "market" matches the "Market"
 * column heading and hands back the header row, whose cells are all labels.
 */
const rowsIn = (panel: ReturnType<Page["getByRole"]>) =>
  panel.locator("tbody tr");

test("the same trade reads LONG/taker to one account and SHORT/maker to the other", async ({
  page,
  request,
}) => {
  const marketId = await marketIdFor(request, "SOL-USD");
  const price = await freeAskPrice(request, marketId);

  // The maker rests an ask over the API; the browser account lifts it.
  await apiAccount(request, "maker");
  // Exactly what the taker below lifts: a half-filled maker order would rest,
  // become the best ask, and leave the next run with nowhere to price into.
  await restingAsk(request, price, 1);

  await fundedAccount(page, "5000");
  await placeOrder(page, { price: String(price), qty: "1" });
  await expect(
    page
      .getByRole("region", { name: /notifications/i })
      .getByText("Filled", { exact: true }),
  ).toBeVisible();

  await waitForFillAt(page.request, price);

  // The taker's view — the browser's own cookie jar.
  const mine = await fillsFor(page.request);
  const myFill = mine.fills.find((f) => Number(f.price) === price);
  expect(myFill).toBeDefined();
  expect(myFill!.side).toBe("LONG");
  expect(myFill!.role).toBe("taker");
  expect(myFill!.marketSlug).toBe("SOL-USD");

  // The maker's view of the SAME fill, from the other cookie jar.
  const theirs = await fillsFor(request);
  const theirFill = theirs.fills.find((f) => f.id === myFill!.id);
  expect(theirFill).toBeDefined();
  expect(theirFill!.side).toBe("SHORT");
  expect(theirFill!.role).toBe("maker");
  // Same trade: same size, same price.
  expect(theirFill!.qty).toBe(myFill!.qty);
  expect(theirFill!.price).toBe(myFill!.price);
  // Different orders, which is what each side's direction was read from.
  expect(theirFill!.orderId).not.toBe(myFill!.orderId);

  // And it is on screen, with the word — direction never travels by colour.
  const panel = await openPanel(page, /Fill history/);
  const row = rowsIn(panel).filter({ hasText: "SOL-USD" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("LONG");
  await expect(row).toContainText("taker");
  // The Fee column is gone: no fee exists anywhere in the system (D4).
  await expect(panel.getByRole("columnheader", { name: "Fee" })).toHaveCount(0);
});

test("a fill appears exactly once per participant", async ({
  page,
  request,
}) => {
  const marketId = await marketIdFor(request, "SOL-USD");
  const price = await freeAskPrice(request, marketId);

  await apiAccount(request, "dupe");
  await restingAsk(request, price, 3);

  await fundedAccount(page, "5000");
  await placeOrder(page, { price: String(price), qty: "3" });
  await waitForFillAt(page.request, price);

  const mine = await fillsFor(page.request);
  const atPrice = mine.fills.filter((f) => Number(f.price) === price);
  // One trade, one row — not one per side, and not one per participant.
  expect(atPrice).toHaveLength(1);
  expect(new Set(atPrice.map((f) => `${f.id}:${f.role}`)).size).toBe(1);
});

test("fills are paged rather than unbounded", async ({ page, request }) => {
  // G11. The route used to return the account's entire history in one response.
  const marketId = await marketIdFor(request, "SOL-USD");
  const price = await freeAskPrice(request, marketId);

  await apiAccount(request, "pager");
  await restingAsk(request, price, 6);

  await fundedAccount(page, "20000");
  // Three separate takes against the same resting ask: three fills.
  for (const qty of ["1", "2", "3"]) {
    await placeOrder(page, { price: String(price), qty });
  }
  await expect
    .poll(async () => {
      const { fills } = await fillsFor(page.request);
      return fills.filter((f) => Number(f.price) === price).length;
    })
    .toBe(3);

  const firstPage = await fillsFor(page.request, "?limit=2");
  expect(firstPage.fills.length).toBeLessThanOrEqual(2);
  expect(firstPage.nextCursor).not.toBeNull();

  const secondPage = await fillsFor(
    page.request,
    `?limit=2&before=${encodeURIComponent(firstPage.nextCursor!)}`,
  );
  // No repeats across the boundary — the cursor carries the row id as well as
  // the timestamp, and fills written by one sweep share a timestamp.
  const first = new Set(firstPage.fills.map((f) => f.id));
  expect(secondPage.fills.some((f) => first.has(f.id))).toBe(false);

  // And the market filter narrows it to one market.
  const eth = await fillsFor(
    page.request,
    `?marketId=${await marketIdFor(request, "ETH-USD")}`,
  );
  expect(eth.fills.every((f) => f.marketSlug === "ETH-USD")).toBe(true);
});

test("order history shows terminal orders only, and prices a market order from its fills", async ({
  page,
  request,
}) => {
  const marketId = await marketIdFor(request, "SOL-USD");
  const price = await freeAskPrice(request, marketId);

  await apiAccount(request, "hist");
  await restingAsk(request, price, 2);

  await fundedAccount(page, "40000");

  // 1. A market order, which fills against the ask above. Its `orders.price`
  //    column is the 0 the client sent (G29), so the table has to price it
  //    from the fills instead.
  await placeOrder(page, { type: "market", qty: "2" });

  // 2. A resting limit order, which must stay OUT of history.
  await page.getByRole("radio", { name: "Limit" }).click();
  const restingPrice = await freeRestingBidPrice(request, marketId);
  await placeOrder(page, { price: String(restingPrice), qty: "1" });

  /**
   * Wait for db-writer BEFORE opening the tab, not after.
   *
   * The panel fetches once on activation; an order still `pending` in Postgres
   * is simply absent, and a `toBeVisible` retry cannot fix that because nothing
   * refetches on its own.
   */
  await expect
    .poll(async () => {
      const res = await page.request.get(`${API}/orders/${marketId}`);
      const { orders } = (await res.json()) as {
        orders: { orderType: string; status: string }[];
      };
      return orders.some(
        (o) => o.orderType === "market" && o.status === "filled",
      );
    })
    .toBe(true);

  const panel = await openPanel(page, /Order history/);
  const rows = rowsIn(panel);
  const marketRow = rows.filter({ hasText: "market" }).first();
  await expect(marketRow).toBeVisible();
  await expect(marketRow).toContainText("filled");

  /**
   * Exactly one row: the account is new and has placed exactly two orders, and
   * the resting one belongs to Open orders. A row in both tables, one with a
   * Cancel button and one without, reads as two orders.
   *
   * Counted rather than matched on the resting price — that price is a small
   * integer and Playwright's `hasText` is a substring, so it also matches the
   * quantity in the market row.
   */
  await expect(rows).toHaveCount(1);
  await expect(rows.filter({ hasText: "partially filled" })).toHaveCount(0);

  // The market row carries a real executed price — never the 0.00 its own
  // price column holds, and never an em dash: it filled.
  const text = (await marketRow.textContent()) ?? "";
  expect(text).toContain(String(price));
  expect(text).not.toContain("0.00");
});

test("neither historical tab is fetched until it is opened", async ({
  page,
}) => {
  // History is the only data here that is not needed to trade, so it is lazy.
  const asked: string[] = [];
  await page.route("**/fills*", async (route) => {
    asked.push(route.request().url());
    await route.continue();
  });

  await fundedAccount(page, "1000");
  // The terminal has fully loaded — positions, orders and balances are all in.
  await expect(page.getByRole("tab", { name: /Positions/ })).toBeVisible();
  await expect(page.getByText("No open positions")).toBeVisible();
  expect(asked).toHaveLength(0);

  await openPanel(page, /Fill history/);
  await expect.poll(() => asked.length).toBeGreaterThan(0);
});
