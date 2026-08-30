import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type WebSocket,
} from "@playwright/test";

/**
 * Phase 11's gate: the ladder is the exchange's own book, and when the feed is
 * not working the terminal says so instead of making something up.
 *
 * The thing being verified is mostly an absence. Until this phase the terminal
 * fell back to a simulator — a random walk, an invented 14-level book, a fake
 * trade tape — whenever the socket was slow to open, and surfaced it as a
 * "simulated" badge that was easy to miss. Every spec here therefore asserts
 * two things at once: the numbers on screen came from the server, AND the
 * status vocabulary is telling the truth about where they came from.
 *
 * Unlike the Phase 7-10 suites this one places no orders. It reads the book
 * whatever state the rest of the run has left it in, which is also why every
 * comparison is against a live `GET /depth` rather than against any price
 * chosen here — see "a price hardcoded in an E2E spec is a bug with a delay
 * fuse" in PROGRESS.md.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const PASSWORD = "pw123456";

/** The ladder renders 11 levels a side. */
const ROWS = 11;

async function account(page: Page) {
  const username = `e2e-feed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Trader");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/trade\/SOL-USD/);
  return username;
}

async function marketIdFor(request: APIRequestContext, slug: string) {
  const res = await request.get(`${API}/markets`);
  const { markets } = (await res.json()) as { markets: { id: string; slug: string }[] };
  return markets.find((m) => m.slug === slug)!.id;
}

/** The prices `GET /depth` is showing right now, as the ladder would render them. */
async function restLadder(ctx: APIRequestContext, marketId: string) {
  const res = await ctx.get(`${API}/depth?marketId=${marketId}`);
  const { bids, asks } = (await res.json()) as {
    bids: [string, string][];
    asks: [string, string][];
  };
  return [...bids.slice(0, ROWS), ...asks.slice(0, ROWS)]
    .map(([price]) => Number(price))
    .sort((a, b) => a - b);
}

/**
 * The prices the ladder is actually rendering.
 *
 * Read off each row's `title`, which carries the unformatted number — parsing
 * the visible cell would be parsing `formatNumber`'s thousands separators back
 * out again, and this spec is about the data, not the formatter.
 */
async function renderedLadder(page: Page) {
  const titles = await page.locator('button[title^="Set price to"]').evaluateAll(
    (nodes) => nodes.map((n) => n.getAttribute("title") ?? ""),
  );
  return titles
    .map((t) => Number(t.replace("Set price to ", "").split(" ")[0]))
    .sort((a, b) => a - b);
}

const statusWord = (page: Page) =>
  page.locator("text=/^(live|connecting|reconnecting|disconnected|stale)$/").first();

/**
 * "Connected", as the status dot can legitimately word it.
 *
 * `live` and `stale` are the same connection: the socket is open and the
 * snapshot has been applied. They differ on whether frames are still arriving,
 * and that depends on whether **price-poller** is running — it is what drives
 * the ~1 Hz depth broadcast. The rest of this suite cannot run with the poller
 * up (see PROGRESS.md: it feeds the engine the real index while the specs trade
 * at a few dollars, and every short is liquidated the moment a spot update
 * lands), so a run of the whole file reads `stale` and a run against a fully
 * live stack reads `live`. Both are correct, and neither is `reconnecting`,
 * which is what this assertion is really excluding.
 */
const CONNECTED = /^(live|stale)$/;

test("the ladder is the exchange's own book, level for level", async ({ page, request }) => {
  const solId = await marketIdFor(request, "SOL-USD");
  await account(page);

  await expect(statusWord(page)).toHaveText(CONNECTED);

  /**
   * Polled rather than compared once: the price poller republishes depth at
   * ~1 Hz, so the REST read and the render are always a moment apart. What is
   * being asserted is that they converge — a simulator never would, because its
   * levels are drawn around a random walk of its own.
   */
  await expect
    .poll(async () => {
      const [rendered, rest] = await Promise.all([
        renderedLadder(page),
        restLadder(request, solId),
      ]);
      return JSON.stringify(rendered) === JSON.stringify(rest);
    })
    .toBe(true);
});

test("with the socket blocked the ladder is a REST book, labelled not-live", async ({
  page,
  request,
}) => {
  const solId = await marketIdFor(request, "SOL-USD");

  // Every upgrade to ws-server is accepted by the browser and closed
  // immediately — the shape of "ws-server is down, the backend is not".
  await page.routeWebSocket(/3010/, (ws) => ws.close());

  await account(page);

  await expect(statusWord(page)).toHaveText("reconnecting");

  // The book is still real. This is the assertion the old code could not have
  // passed: it would have been showing a simulated ladder by now.
  const rest = await restLadder(request, solId);
  await expect.poll(async () => renderedLadder(page)).toEqual(rest);
});

test("switching market never leaves two sockets open", async ({ page, request }) => {
  const solId = await marketIdFor(request, "SOL-USD");
  const btcId = await marketIdFor(request, "BTC-USD");

  const sockets: WebSocket[] = [];
  page.on("websocket", (ws) => {
    // The dev server's HMR socket is on the web port, not the feed port.
    if (ws.url().includes("market_id=")) sockets.push(ws);
  });
  const open = () => sockets.filter((ws) => !ws.isClosed());

  await account(page);
  await expect(statusWord(page)).toHaveText(CONNECTED);

  /**
   * The invariant is one socket OPEN, not one socket ever created: React's
   * StrictMode double-mounts every effect in dev, so the provider legitimately
   * builds a socket, tears it down and builds another before the page settles.
   * Counting constructions here failed for that reason and the count was right.
   */
  await expect.poll(() => open().length).toBe(1);
  expect(open()[0]!.url()).toContain(`market_id=${solId}`);

  await page.getByRole("link", { name: "BTC-USD" }).first().click();
  await expect(page).toHaveURL(/\/trade\/BTC-USD/);
  await expect(statusWord(page)).toHaveText(CONNECTED);

  // ws-server settles both parameters at the HTTP upgrade and has no
  // client→server protocol, so a market switch has to be a new socket — and the
  // old one has to be gone, or two markets' depth frames feed one ladder.
  await expect.poll(() => open().length).toBe(1);
  expect(open()[0]!.url()).toContain(`market_id=${btcId}`);
});

test("the trades pane no longer denies that a tape exists", async ({ page }) => {
  await account(page);
  await expect(statusWord(page)).toHaveText(CONNECTED);

  await page.getByRole("radio", { name: "Trades" }).click();

  /**
   * Inverted by Phase 12. Through Phase 11 this asserted "No public trade
   * tape": ws-server accepted a subscription to `feed:{id}:trades` and nothing
   * ever published to it (G16), so "trades appear here the moment the book
   * crosses" was a promise the system could not keep. It can now, and this
   * pane is the one place a user would wait for it.
   *
   * What is left here is the negative. Whether prints have actually arrived
   * depends on whether anything traded while this browser was connected, which
   * is not this spec's business — `public-feed.e2e.ts` opens a tape, causes a
   * trade and watches it land.
   */
  await expect(page.getByText("No public trade tape")).toHaveCount(0);
});
