import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * Phase 9's gate: the Positions tab is this account's real positions with an
 * honestly derived mark and PnL, and Close actually flattens.
 *
 * G13 is what this suite is really about. A close is a market order with
 * `equity` OMITTED — that is what makes the engine treat it as risk-reducing
 * and skip the margin requirement. Getting it wrong does not fail loudly in a
 * unit test; it fails as "Margin required as this is a risk increasing order"
 * in front of a user trying to get flat.
 *
 * Requires **db-writer**, like the Phase 8 suite: without it the orders that
 * open these positions never leave `pending`, and the terminal's other panels
 * lie in ways that look like a Phase 9 regression.
 *
 * The engine's book is in-memory and shared across the whole run, so every spec
 * here trades at prices nothing else in the suite uses and asserts on rows it
 * can identify by market.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const PASSWORD = "pw123456";

/** ETH is used by the negative spec alone — see the comment on it. */
const ETH = { ask: 1900 };

/**
 * The two levels the mark spec trades on, chosen against the live book.
 *
 * This was `{ bid: 610, ask: 611 }` — "far above anything the other specs leave
 * behind" — and that reasoning is wrong in a way that only shows up when the
 * spec is actually run. **A limit buy takes the cheapest ask, not the ask at
 * its own limit.** With Phase 7's 150 still resting, a buy at 611 filled there,
 * and the position's entry was 150. The band has to be at the TOUCH: an ask
 * that is the best ask, and a bid immediately under it.
 *
 * Searched in cents, and the ask is rested in the exact size the taker lifts,
 * so the only level this spec leaves behind is its bid — which moves the touch
 * up by one cent a run rather than closing the spread against itself.
 */
async function touchBand(ctx: APIRequestContext, marketId: string) {
  const res = await ctx.get(`${API}/depth?marketId=${marketId}`);
  const { bids, asks } = (await res.json()) as {
    bids: [string, string][];
    asks: [string, string][];
  };
  const prices = (side: [string, string][]) => side.map(([p]) => Number(p));
  const taken = new Set([...prices(bids), ...prices(asks)]);
  const bestBid = bids.length ? Math.max(...prices(bids)) : 1;
  const bestAskPrice = asks.length ? Math.min(...prices(asks)) : bestBid + 100;

  /**
   * Whole dollars first, cents only if the spread has no room for them.
   *
   * Not cosmetic: the engine's collateral arithmetic is floating point, and a
   * position opened at 4.01 and closed at 4.00 leaves `locked` at −0.002
   * instead of 0 — which the "a close leaves no margin locked" assertion below
   * reads as a leak. Integer prices keep that assertion about margin rather
   * than about IEEE 754. The residue itself is noted in PROGRESS.md.
   */
  for (const step of [100, 1]) {
    for (let unit = Math.floor(bestBid * 100 / step) + 1; ; unit++) {
      const bid = (unit * step) / 100;
      const ask = ((unit + 1) * step) / 100;
      if (ask >= bestAskPrice) break;
      if (!taken.has(bid) && !taken.has(ask)) return { bid, ask };
    }
  }
  throw new Error(`no free pair of levels between ${bestBid} and ${bestAskPrice}`);
}

async function fundedAccount(page: Page, deposit: string) {
  const username = `e2e-pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

/** A second account, driven over the API only — it is the other side of a trade. */
async function counterparty(request: APIRequestContext, deposit = 200_000) {
  const username = `e2e-pos-cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await request.post(`${API}/signup`, {
    data: { username, password: PASSWORD, name: "Counterparty" },
  });
  await request.post(`${API}/onramp`, { data: { amount: deposit } });
  return request;
}

async function restingOrder(
  request: APIRequestContext,
  opts: {
    type: "LONG" | "SHORT";
    price: number;
    qty: number;
    market?: string;
  },
) {
  const res = await request.post(`${API}/order`, {
    data: {
      orderType: "limit",
      market: opts.market ?? "SOL-USD",
      type: opts.type,
      price: opts.price,
      slippage: 0,
      qty: opts.qty,
      // 1x. ETH's cap is 3 and SOL's is 30, so full margin clears both.
      equity: opts.price * opts.qty,
    },
  });
  expect(res.ok()).toBeTruthy();
  return res;
}

/** Fills the ticket and drives it through the confirm dialog. */
async function placeOrder(page: Page, opts: { price: string; qty: string }) {
  await page.getByLabel("Limit price").fill(opts.price);
  await page.getByLabel("Quantity").fill(opts.qty);
  await page.getByRole("button", { name: /^Buy / }).first().click();
  await page.getByRole("button", { name: /^Confirm buy/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

const positionsPanel = async (page: Page) => {
  await page.getByRole("tab", { name: /Positions/ }).click();
  return page.getByRole("tabpanel");
};

const balancesFor = async (page: Page) => {
  const res = await page.request.get(`${API}/equity/balances`);
  const { balances } = (await res.json()) as {
    balances: { available: string | number; locked: string | number };
  };
  return {
    available: Number(balances.available),
    locked: Number(balances.locked),
  };
};

async function marketIdFor(request: APIRequestContext, slug: string) {
  const res = await request.get(`${API}/markets`);
  const { markets } = (await res.json()) as {
    markets: { id: string; slug: string }[];
  };
  return markets.find((m) => m.slug === slug)!.id;
}

test("a crossing trade opens a position, and closing it flattens and releases the margin", async ({
  page,
  request,
}) => {
  const solId = await marketIdFor(request, "SOL-USD");
  /**
   * At the touch, not at a band picked in advance — a limit buy takes the
   * cheapest ask, and the close is a market order bounded off the BEST bid, so
   * both sides of this test have to own the top of the book. Sized so that both
   * levels are consumed whole and the book is as it was found.
   */
  const band = await touchBand(request, solId);

  const cp = await counterparty(request);
  // The other side of both trades: an ask to open into, a bid to close into.
  await restingOrder(cp, { type: "SHORT", price: band.ask, qty: 2 });
  await restingOrder(cp, { type: "LONG", price: band.bid, qty: 2 });

  await fundedAccount(page, "20000");

  // Crosses the resting ask outright.
  await placeOrder(page, { price: String(band.ask), qty: "2" });
  await expect(
    page
      .getByRole("region", { name: /notifications/i })
      .getByText("Filled", { exact: true }),
  ).toBeVisible();

  const panel = await positionsPanel(page);
  const row = panel.getByRole("row").filter({ hasText: "SOL-USD" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("LONG");

  // Margin is locked while the position is open.
  await expect.poll(async () => (await balancesFor(page)).locked).toBeGreaterThan(0);

  await row.getByRole("button", { name: "Close" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Close SOL-USD position?");
  await dialog.getByRole("button", { name: "Close position" }).click();

  // The row goes only once the refetch agrees — the close is not optimistic.
  await expect(panel.getByRole("row").filter({ hasText: "SOL-USD" })).toHaveCount(
    0,
  );
  await expect(panel.getByText("No open positions")).toBeVisible();

  // The server agrees, over its own endpoint.
  await expect
    .poll(async () => {
      const res = await page.request.get(`${API}/positions/open/${solId}`);
      const { positions } = (await res.json()) as { positions: unknown[] };
      return positions.length;
    })
    .toBe(0);

  /**
   * The phase's acceptance criterion, and the reason `equity` is omitted:
   * closing must never leave margin locked. A close that sent the position's
   * margin would lock a SECOND margin to get flat.
   */
  await expect.poll(async () => (await balancesFor(page)).locked).toBe(0);
});

test("the mark and PnL are derived, and the header stops showing an em dash", async ({
  page,
  request,
}) => {
  const solId = await marketIdFor(request, "SOL-USD");
  const band = await touchBand(request, solId);

  const cp = await counterparty(request);
  // Exactly the size the taker lifts, so the ask level is consumed whole.
  await restingOrder(cp, { type: "SHORT", price: band.ask, qty: 1 });
  await restingOrder(cp, { type: "LONG", price: band.bid, qty: 1 });

  await fundedAccount(page, "20000");
  await placeOrder(page, { price: String(band.ask), qty: "1" });

  const panel = await positionsPanel(page);
  const row = panel.getByRole("row").filter({ hasText: "SOL-USD" }).first();
  await expect(row).toBeVisible();

  /**
   * Entry is the executed average, and the mark is the mid of the book the
   * ladder is showing — not the engine's `pnL`, which is only written during
   * netting (G12) and would be stale by an unbounded amount.
   */
  await expect(row).toContainText(band.ask.toFixed(2));
  // A signed PnL, not an em dash: the book is two-sided, so the mark is known.
  await expect(row).toContainText(/[+−]\d/);

  // The header's unrealised-PnL Delta was a permanent em dash before this phase.
  const equity = page.locator("header").getByText(/^[+−]\d/);
  await expect(equity.first()).toBeVisible();
});

test("closing into an empty book is refused, verbatim, and the position survives", async ({
  page,
  request,
}) => {
  /**
   * The negative gate. With no bid to sell into, the engine answers
   * "There are no matches available" — and that sentence, not a paraphrase of
   * it, is what the user must see. The position is untouched.
   *
   * **ETH-USD, not SOL-USD, and that is load-bearing.** A close is a market
   * order bounded 1% off the BEST bid, so it matches whatever the top of the
   * book happens to be — and the SOL book is shared with every other spec in
   * the run and survives between runs in the engine's snapshot. The only way to
   * mean "there is nothing to sell into" is a book nothing else rests a bid in.
   * ETH is that book: the counterparty below rests an ASK, which this account
   * consumes whole, and no spec anywhere rests an ETH bid.
   */
  const marketId = await marketIdFor(request, "ETH-USD");
  const cp = await counterparty(request);
  await restingOrder(cp, {
    market: "ETH-USD",
    type: "SHORT",
    price: ETH.ask,
    qty: 1,
  });

  await fundedAccount(page, "20000");
  await page.goto("/trade/ETH-USD");

  // Exactly the resting size, so it fills whole and leaves nothing on the book.
  await placeOrder(page, { price: String(ETH.ask), qty: "1" });

  // The precondition, asserted rather than assumed — if this fails, the spec is
  // testing nothing and should say so rather than pass by accident.
  const depth = await page.request.get(`${API}/depth?marketId=${marketId}`);
  const { bids } = (await depth.json()) as { bids: [string, string][] };
  expect(bids).toEqual([]);

  const panel = await positionsPanel(page);
  const row = panel.getByRole("row").filter({ hasText: "ETH-USD" }).first();
  await expect(row).toBeVisible();

  // One-sided book: no mid, so the mark and PnL cells are em dashes, and the
  // Close button is still offered — the engine decides the fill, not the mark.
  await expect(row).toContainText("—");

  await row.getByRole("button", { name: "Close" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Close position" }).click();

  /**
   * Matched through `role="alert"` INSIDE the dialog. This is D11, and this
   * assertion is what closing it is worth.
   *
   * The refusal used to be a toast. The dialog stays open when a close fails
   * (deliberately: the position is untouched and the obvious next action is
   * the button already on screen), and Radix marks everything outside an open
   * dialog `aria-hidden` — while the toast viewport lives at the app root,
   * outside it. So the engine's own words were painted, readable, and out of
   * the accessibility tree, on the one action in this app that realises money.
   * This spec could not see them either, which is how it was found.
   *
   * Phase 14 moved the message into the dialog. Asserting it through the role
   * is the point: `getByText` would pass against either version.
   */
  const refusal = dialog.getByRole("alert");
  await expect(refusal).toContainText("There are no matches available");

  /**
   * Dismiss the dialog before reading the table behind it — for the same reason
   * the refusal above is matched by text. While the dialog is open the rest of
   * the page is `aria-hidden`, so `getByRole("row")` resolves to nothing and
   * this assertion would report the position as gone when it is simply covered.
   */
  await dialog.getByRole("button", { name: "Keep position" }).click();
  await expect(dialog).toBeHidden();

  // Untouched: still one position, still closeable once there is a bid.
  await expect(panel.getByRole("row").filter({ hasText: "ETH-USD" })).toHaveCount(
    1,
  );
});
