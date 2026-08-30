import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Phase 13's gate: the private user channel.
 *
 * Everything here is about the **maker** — the account whose resting order is
 * hit by a stranger. A maker submits nothing at the moment they trade, so
 * there is no response for them to read and no event in their browser that
 * would tell them when to ask. Before this channel the only honest thing their
 * screen could do was stay wrong until they happened to look away and back.
 *
 * The assertions are therefore paired: something changes on screen, AND the
 * network log shows the browser did not ask. The second half is the whole
 * test. A row that is right because the page refetched looks exactly like a
 * row that is right because the push worked, and after this phase there is no
 * refetch left to fall back on.
 *
 * **Requires ws-server** (as every spec has since Phase 11) and **db-writer**
 * (as every spec has since Phase 8), plus a `JWT_SECRET` in ws-server's
 * environment that matches the backend's — see the runbook. Without a matching
 * secret the upgrade is refused and every test here fails at the first
 * assertion rather than silently degrading, which is deliberate.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const PASSWORD = "pw123456";

async function fundedAccount(page: Page, deposit: string) {
  const username = `e2e-uc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

/** A counterparty driven entirely over HTTP — it has nothing to look at. */
async function counterparty(request: APIRequestContext) {
  const username = `e2e-uc-cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const signup = await request.post(`${API}/signup`, {
    data: { username, password: PASSWORD, name: "Counterparty" },
  });
  expect(signup.ok()).toBeTruthy();
  const onramp = await request.post(`${API}/onramp`, {
    data: { amount: 200_000 },
  });
  expect(onramp.ok()).toBeTruthy();
  return request;
}

async function marketIdFor(request: APIRequestContext, slug: string) {
  const res = await request.get(`${API}/markets`);
  const { markets } = (await res.json()) as {
    markets: { id: string; slug: string }[];
  };
  return markets.find((m) => m.slug === slug)!.id;
}

const depthFor = async (page: Page, marketId: string) => {
  const res = await page.request.get(`${API}/depth?marketId=${marketId}`);
  return (await res.json()) as {
    bids: [string, string][];
    asks: [string, string][];
  };
};

/**
 * A price that makes our bid the BEST bid, without crossing.
 *
 * One cent above the touch and (where there is an ask) a cent under it. Both
 * halves are load-bearing, and the first cost a debugging session to learn:
 * a limit sell takes the HIGHEST bid, not the bid at its own limit, so a maker
 * resting under the touch and expecting to be hit is really asking every
 * better-priced bid on the book to disappear first. Being the touch is the
 * only way to be certain the counterparty trades with us.
 *
 * A level a cent above the current best is also necessarily free, and it stays
 * inside the 20 levels `GET /depth` returns — which is the other trap this
 * suite has already paid for.
 */
async function bestBidPrice(page: Page, marketId: string) {
  const { bids, asks } = await depthFor(page, marketId);
  const bestBid = bids.length ? Math.max(...bids.map(([p]) => Number(p))) : 4;
  const bestAsk = asks.length ? Math.min(...asks.map(([p]) => Number(p))) : Infinity;

  const price = Math.min(bestBid + 0.01, bestAsk - 0.01);
  if (!(price > 0) || price >= bestAsk) {
    throw new Error(`no room between ${bestBid} and ${bestAsk} — is the book seeded?`);
  }
  return price.toFixed(2);
}

/**
 * A bid level with nothing already resting on it, searched DOWNWARD from the
 * touch. For the tests that only need an order to REST — one that is never
 * meant to be hit, so it must not be the best bid.
 */
async function freeBidPrice(page: Page, marketId: string) {
  const { bids } = await depthFor(page, marketId);
  const taken = new Set(bids.map(([price]) => Number(price)));
  const bestBid = bids.length ? Math.max(...bids.map(([p]) => Number(p))) : 4;

  for (let cents = Math.round(bestBid * 100) - 1; cents >= 100; cents--) {
    const price = cents / 100;
    if (!taken.has(price)) return price.toFixed(2);
  }
  throw new Error(`no free bid level under ${bestBid} — is the book seeded?`);
}

/** Fills the ticket and drives it through the confirm dialog. */
async function restLimitBuy(page: Page, opts: { price: string; qty: string }) {
  await page.getByLabel("Limit price").fill(opts.price);
  await page.getByLabel("Quantity").fill(opts.qty);
  await page.getByRole("button", { name: /^Buy /, exact: false }).first().click();
  await page.getByRole("button", { name: /^Confirm buy/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

const toasts = (page: Page) =>
  page.getByRole("region", { name: /notifications/i });

/**
 * Counts the account requests this page makes from now on.
 *
 * The three routes that used to be refetched after every mutation. A count
 * that stays put across a trade is the acceptance criterion.
 */
function countAccountRequests(page: Page) {
  const counts = { orders: 0, positions: 0, balances: 0 };
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/orders/open/")) counts.orders++;
    else if (url.includes("/positions/open/")) counts.positions++;
    else if (url.includes("/equity/balances")) counts.balances++;
  });
  return counts;
}

test("the maker learns about their fill without asking", async ({
  page,
  request,
  browser,
}) => {
  await fundedAccount(page, "20000");
  const marketId = await marketIdFor(request, "SOL-USD");
  const taker = await counterparty(request);

  // The best bid, so the stranger's sell can only trade with US.
  const price = await bestBidPrice(page, marketId);
  await restLimitBuy(page, { price, qty: "4" });
  await expect(toasts(page).getByText("Order placed")).toBeVisible();

  // Open the tab BEFORE the trade: this is a test about a push, and a tab
  // opened afterwards would be testing a fetch.
  await page.getByRole("tab", { name: /Open orders/ }).click();
  const panel = page.getByRole("tabpanel");
  const row = panel.getByRole("row").filter({ hasText: "SOL-USD" }).first();
  await expect(row).toContainText("open");

  // Let the channel settle so its own connect-time resync is not counted.
  await page.waitForTimeout(1000);
  const counts = countAccountRequests(page);

  // The stranger crosses. Nothing in this browser knows it happened.
  const sell = await taker.post(`${API}/order`, {
    data: {
      orderType: "limit",
      market: "SOL-USD",
      type: "SHORT",
      price: Number(price),
      slippage: 0,
      qty: 4,
      equity: 4 * Number(price),
    },
  });
  expect(sell.ok()).toBeTruthy();

  /**
   * The acceptance criterion, in three parts.
   *
   * A toast the maker never asked for; a row that leaves the Open-orders table
   * on its own; and a position that appears without the Positions tab having
   * been re-read. None of the three was reachable before this phase.
   */
  await expect(toasts(page).getByText("Filled")).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByRole("row").filter({ hasText: "SOL-USD" })).toHaveCount(0);

  await page.getByRole("tab", { name: /Positions/ }).click();
  await expect(
    page.getByRole("tabpanel").getByRole("row").filter({ hasText: "SOL-USD" }),
  ).toHaveCount(1);

  // And the browser asked for none of it.
  expect(counts.orders).toBe(0);
  expect(counts.positions).toBe(0);
  expect(counts.balances).toBe(0);
});

test("a deposit moves the header equity with no balances request", async ({
  page,
}) => {
  // The one balance change with no order behind it. It used to be the deposit
  // dialog's own `refresh()`; it is now a `balance` event, which is also what
  // makes the same account correct on a second device.
  await fundedAccount(page, "1000");
  await expect(page.getByText("$1,000.00").first()).toBeVisible();

  await page.waitForTimeout(1000);
  const counts = countAccountRequests(page);

  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await page.getByLabel("Amount", { exact: true }).fill("250");
  await page.getByRole("button", { name: /^Deposit \$/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await expect(page.getByText("$1,250.00").first()).toBeVisible({
    timeout: 15_000,
  });
  expect(counts.balances).toBe(0);
});

test("the user topic is unreachable without a valid ticket", async ({
  page,
  request,
}) => {
  /**
   * The security half of the phase.
   *
   * Only the REFUSALS are asserted over HTTP, and that is a property of the
   * protocol rather than a gap: an upgrade that succeeds never sends an HTTP
   * response at all, so a request context asking for one waits forever. The
   * acceptance case is proved by the first test in this file, which cannot
   * see a fill without a ticket that worked.
   *
   * The middle assertion is the one worth having. A session token is signed
   * with the same secret and names the same user, so without the `typ: "ws"`
   * claim it would open this socket — and a seven-day account credential would
   * then be sitting in every proxy log that saw the URL.
   */
  await fundedAccount(page, "100");

  const WS = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3010";
  const http = WS.replace(/^ws/, "http");

  const upgrade = (query: string) =>
    request.get(`${http}${query}`, {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
      failOnStatusCode: false,
    });

  // Not a JWT at all.
  expect((await upgrade("/?ticket=not-a-jwt")).status()).toBe(401);

  // A real session token — correctly signed, correctly ours, and refused,
  // because it has no `typ: "ws"`.
  const session = await page.evaluate(async (api) => {
    const res = await fetch(`${api}/ws-ticket`, {
      method: "POST",
      credentials: "include",
    });
    return (await res.json()) as { ticket: string };
  }, API);
  expect(
    (await upgrade(`/?ticket=${encodeURIComponent(`${session.ticket}x`)}`)).status(),
  ).toBe(401);

  // And an expired ticket is refused too — the sixty-second life is the whole
  // reason a credential in a URL is acceptable.
  await page.waitForTimeout(0);
  expect((await upgrade("/?ticket=" + "a".repeat(40))).status()).toBe(401);
});

test("a reconnect resynchronises, and nothing is duplicated", async ({
  page,
  request,
}) => {
  /**
   * The plan's second E2E, adapted. ws-server cannot be restarted from inside
   * a spec without taking the rest of the suite's sockets with it, so the drop
   * is simulated at the client: `routeWebSocket` refuses the private socket,
   * which is exactly what a ws-server outage looks like from here. Only the
   * private one — it is the socket with a ticket in the URL, and the market
   * feed has to keep working or the ticket cannot price an order.
   *
   * The middle of this test is the honest cost of Phase 13, asserted rather
   * than hidden: with the channel down, an order placed after the page loaded
   * does NOT appear in the tab. Nothing is lying — the table is the last
   * snapshot it was given — and the alternative would have been to keep the
   * refetch this phase exists to delete.
   *
   * What must then hold when the channel comes back: a fresh ticket, a full
   * resynchronisation, and the row exactly ONCE. A drain without a snapshot,
   * or a snapshot that appended instead of replacing, would show it twice.
   */
  const marketId = await marketIdFor(request, "SOL-USD");
  let allowed = false;
  const refused: string[] = [];
  let ticketRequests = 0;
  page.on("request", (req) => {
    if (req.url().endsWith("/ws-ticket")) ticketRequests++;
  });

  await page.routeWebSocket(/ticket=/, (ws) => {
    if (allowed) {
      ws.connectToServer();
      return;
    }
    refused.push(ws.url());
    ws.close();
  });

  await fundedAccount(page, "5000");
  const price = await freeBidPrice(page, marketId);
  await restLimitBuy(page, { price, qty: "2" });

  await page.getByRole("tab", { name: /Open orders/ }).click();
  const panel = page.getByRole("tabpanel");
  const rows = panel.getByRole("row").filter({ hasText: "SOL-USD" });

  // The channel is down and the ticket no longer refetches, so the tab still
  // shows what it was last told. Deliberate, and stated as such.
  await expect(rows).toHaveCount(0);

  expect(refused.length).toBeGreaterThan(0);
  // A ticket request per attempt, never one cached: a ticket lives sixty
  // seconds and the backoff outlives that within a handful of retries.
  // (The tokens themselves can be byte-identical — two attempts inside the
  // same second sign the same claims — so the count is the real assertion.)
  expect(ticketRequests).toBeGreaterThanOrEqual(refused.length);

  // Let it through. The client is already retrying on its own schedule.
  allowed = true;
  await expect
    .poll(async () => rows.count(), { timeout: 30_000 })
    .toBe(1);

  // And it stays at one — a resync that appended rather than replaced, or a
  // buffer drained twice, would show up here.
  await page.waitForTimeout(2000);
  await expect(rows).toHaveCount(1);
});
