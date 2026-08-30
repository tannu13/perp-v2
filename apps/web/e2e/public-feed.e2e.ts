import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Phase 12's gate: the two feeds that were subscribed to and never published.
 *
 * `trades` accepted a subscription and nothing ever wrote to it (G16), and
 * `mark-price` broadcast the value each market was seeded with, forever (G15).
 * Both now carry something real, and each spec here is about the *source* of a
 * number rather than its value: a print appears on a browser that did not place
 * the order, and the index on the market bar is Binance's, not the engine's
 * opening constant.
 *
 * Requires **db-writer** like the Phase 8-10 suites, and — for the index spec
 * alone — **price-poller**, which is the one process the rest of the suite has
 * to run without. That spec skips itself, loudly, rather than passing vacuously
 * when the poller is down. See D14 in PROGRESS.md.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const PASSWORD = "pw123456";

/** The SOL seed the engine used to broadcast as its index, forever. */
const SOL_SEED_INDEX = 85;

async function marketIdFor(request: APIRequestContext, slug: string) {
  const res = await request.get(`${API}/markets`);
  const { markets } = (await res.json()) as {
    markets: { id: string; slug: string }[];
  };
  return markets.find((m) => m.slug === slug)!.id;
}

/**
 * A pair of adjacent free levels at the touch, in whole dollars where the
 * spread allows it.
 *
 * The same helper the Phase 9 suite arrived at the hard way, and for the same
 * reason: a price chosen in advance is somebody else's resting order by the
 * second run, and a limit buy takes the *cheapest* ask rather than the ask at
 * its own limit — so a band "far above everything" still fills somewhere else.
 * It also has to stay within the 20 levels `GET /depth` returns.
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

  for (const step of [100, 1]) {
    for (let unit = Math.floor((bestBid * 100) / step) + 1; ; unit++) {
      const bid = (unit * step) / 100;
      const ask = ((unit + 1) * step) / 100;
      if (ask >= bestAskPrice) break;
      if (!taken.has(bid) && !taken.has(ask)) return { bid, ask };
    }
  }
  throw new Error(`no free pair of levels between ${bestBid} and ${bestAskPrice}`);
}

async function account(page: Page, tag: string) {
  const username = `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Trader");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trade\/SOL-USD/);
  return username;
}

async function fundedAccount(page: Page, deposit: string) {
  const username = await account(page, "tape");
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill(deposit);
  await page.getByRole("button", { name: /^Deposit \$/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  return username;
}

/** The other side of the trade, driven over HTTP — it has nothing to look at. */
async function counterparty(request: APIRequestContext, deposit = 200_000) {
  const username = `e2e-tape-cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await request.post(`${API}/signup`, {
    data: { username, password: PASSWORD, name: "Counterparty" },
  });
  await request.post(`${API}/onramp`, { data: { amount: deposit } });
  return request;
}

async function restingOrder(
  request: APIRequestContext,
  opts: { type: "LONG" | "SHORT"; price: number; qty: number },
) {
  const res = await request.post(`${API}/order`, {
    data: {
      orderType: "limit",
      market: "SOL-USD",
      type: opts.type,
      price: opts.price,
      slippage: 0,
      qty: opts.qty,
      equity: opts.price * opts.qty,
    },
  });
  expect(res.ok()).toBeTruthy();
  return res;
}

async function placeOrder(page: Page, opts: { price: string; qty: string }) {
  await page.getByLabel("Limit price").fill(opts.price);
  await page.getByLabel("Quantity").fill(opts.qty);
  await page.getByRole("button", { name: /^Buy / }).first().click();
  await page.getByRole("button", { name: /^Confirm buy/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

const statusWord = (page: Page) =>
  page.locator("text=/^(live|connecting|reconnecting|disconnected|stale)$/").first();

/** `live` and `stale` are the same connection — see market-feed.e2e.ts. */
const CONNECTED = /^(live|stale)$/;

/**
 * The value beside a market-bar label.
 *
 * Addressed through the label rather than by position: the bar's stats are one
 * flex row of identically-shaped pairs, and an index into it is a spec that
 * breaks the next time a figure is added or removed.
 */
const stat = (page: Page, label: string) =>
  page.getByText(label, { exact: true }).locator("xpath=following-sibling::span[1]");

test("a crossing trade appears on the tape of a browser that did not place it", async ({
  page,
  browser,
  request,
}) => {
  const solId = await marketIdFor(request, "SOL-USD");
  const band = await touchBand(request, solId);

  /**
   * The observer opens FIRST and trades nothing.
   *
   * Prints are pushed and never backfilled — there is no REST tape — so a
   * client that connects after the trade legitimately sees nothing. Opening the
   * pane before the order is placed is what makes this a test of the feed
   * rather than of a page load.
   */
  const observerContext = await browser.newContext();
  const observer = await observerContext.newPage();

  try {
    await account(observer, "obs");
    await expect(statusWord(observer)).toHaveText(CONNECTED);
    await observer.getByRole("radio", { name: "Trades" }).click();

    // The pane's "there is no tape at all" copy, which was the honest answer
    // through Phase 11 and must not be reachable any more.
    await expect(observer.getByText("No public trade tape")).toHaveCount(0);

    // Exactly the size the taker lifts, so the level is consumed whole and the
    // next run's touch is where this one found it.
    const cp = await counterparty(request);
    await restingOrder(cp, { type: "SHORT", price: band.ask, qty: 1 });

    await fundedAccount(page, "20000");
    await placeOrder(page, { price: String(band.ask), qty: "1" });
    await expect(
      page.getByRole("region", { name: /notifications/i }).getByText("Filled", {
        exact: true,
      }),
    ).toBeVisible();

    /**
     * The print, in the other browser.
     *
     * `Buy` is the trades pane's own screen-reader label for the aggressor's
     * side — the order ticket says "Buy / Long" and "Buy 1 SOL", neither of
     * which matches exactly — so this locator cannot resolve to the ticket. It
     * is also the assertion that the side on a public print is the taker's: the
     * account that lifted the ask is the one this browser is NOT signed in as.
     */
    await expect(observer.getByText("Buy", { exact: true })).toBeVisible();
    await expect(observer.getByText(band.ask.toFixed(2)).first()).toBeVisible();
  } finally {
    await observerContext.close();
  }
});

test("the index price is the spot index, not the value the market was seeded with", async ({
  page,
}) => {
  await account(page, "idx");
  await expect(statusWord(page)).toHaveText(CONNECTED);

  const indexStat = stat(page, "Index price");

  /**
   * A bounded wait, then a skip that names the missing process.
   *
   * `mark-price` is only broadcast on an engine reply, and on an idle book the
   * only thing producing replies is **price-poller**'s ~1 Hz spot update. The
   * rest of this suite runs with the poller stopped (it feeds the engine the
   * real index while these specs trade at a few dollars, and every short is
   * then liquidated on the next tick — see PROGRESS.md, "Run it"), so on a
   * normal full run this spec has nothing to assert against.
   *
   * Skipping with the reason spelled out is the honest outcome. Asserting the
   * em dash instead would turn "the poller is not running" into a green tick
   * for the feature this phase exists to add.
   */
  let text = "—";
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    text = (await indexStat.textContent()) ?? "";
    if (/\d/.test(text)) break;
    await page.waitForTimeout(500);
  }

  test.skip(
    !/\d/.test(text),
    "no mark-price frame arrived — price-poller is not running (D14)",
  );

  const shown = Number(text.replace(/[^0-9.]/g, ""));
  expect(Number.isFinite(shown)).toBe(true);

  // Binance's own spot price for the same symbol, read at the same moment. A
  // few seconds of drift is a couple of tenths of a percent; 5% is generous
  // enough never to flake and tight enough that the seed (85) fails it by a
  // wide margin whatever SOL is doing.
  const res = await page.request.get(
    "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
  );
  const { price } = (await res.json()) as { price: string };
  const binance = Number(price);

  expect(Math.abs(shown - binance) / binance).toBeLessThan(0.05);
  expect(shown).not.toBe(SOL_SEED_INDEX);
});
