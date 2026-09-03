import { MarketListSchema, type TMarketDto } from "@repo/shared";
import env from "./env";
import { createApiClient } from "./services/api-client";
import { createBotAccount } from "./services/bot-account";
import { createMaker } from "./services/maker";
import { createMarketFeed } from "./services/market-feed";
import { createTaker } from "./services/taker";
import type { LadderConfig } from "./services/quote-ladder";

/**
 * Synthetic liquidity for the demo.
 *
 * Two accounts, one process: a maker that rests a two-sided ladder around the
 * index price, and a taker that crosses it. See `maker.ts` for why they must be
 * two accounts and not one.
 */

if (!env.MM_ENABLED) {
  console.log("[market-maker] MM_ENABLED=false — not quoting");
  process.exit(0);
}

const config: LadderConfig = {
  levels: env.MM_LEVELS,
  spreadBps: env.MM_SPREAD_BPS,
  levelStepBps: env.MM_LEVEL_STEP_BPS,
  skewBps: env.MM_SKEW_BPS,
  baseNotional: env.MM_BASE_NOTIONAL,
  sizeGrowth: env.MM_SIZE_GROWTH,
  sizeJitter: env.MM_SIZE_JITTER,
  leverage: env.MM_LEVERAGE,
  requoteBps: env.MM_REQUOTE_BPS,
  maxInventoryNotional: env.MM_MAX_INVENTORY_NOTIONAL,
};

/**
 * Market metadata comes from the API, never from a constant in here.
 *
 * `tickSize`, the two decimal counts and `maxLeverage` all bound what the
 * engine will accept, and `packages/db/src/markets.ts` is their source of
 * truth. A fourth hardcoded copy in this service is the same mistake
 * `apps/web/lib/markets.ts` already made once. The `id`/`slug` split matters
 * too: `POST /order` resolves a market by slug, while `/orders/open/:marketId`,
 * `/positions/open/:marketId` and every `feed:{marketId}:*` topic take the uuid.
 */
const loadMarkets = async (): Promise<TMarketDto[]> => {
  const response = await fetch(`${env.API_URL}/markets`);
  if (!response.ok) {
    throw new Error(`GET /markets failed: ${response.status}`);
  }
  const { markets } = MarketListSchema.parse(await response.json());

  if (!env.MM_MARKETS.length) return markets;

  const wanted = new Set(env.MM_MARKETS);
  const selected = markets.filter((market) => wanted.has(market.slug));
  const missing = env.MM_MARKETS.filter(
    (slug) => !markets.some((market) => market.slug === slug),
  );
  if (missing.length) {
    throw new Error(`MM_MARKETS names unknown markets: ${missing.join(", ")}`);
  }
  return selected;
};

const markets = await loadMarkets();

const makerAccount = createBotAccount({
  client: createApiClient({
    baseUrl: env.API_URL,
    label: "maker",
    credentials: {
      username: env.MM_USERNAME,
      password: env.MM_PASSWORD,
      name: env.MM_NAME,
    },
  }),
  balanceFloor: env.MM_BALANCE_FLOOR,
  topUp: env.MM_TOPUP,
});

const takerAccount = createBotAccount({
  client: createApiClient({
    baseUrl: env.API_URL,
    label: "taker",
    credentials: {
      username: env.TAKER_USERNAME,
      password: env.TAKER_PASSWORD,
      name: env.TAKER_NAME,
    },
  }),
  balanceFloor: env.MM_BALANCE_FLOOR,
  topUp: env.MM_TOPUP,
});

await makerAccount.boot();
if (env.TAKER_ENABLED) await takerAccount.boot();

const feed = createMarketFeed({
  wsUrl: env.WS_URL,
  marketIds: markets.map((market) => market.id),
});
feed.start();

const maker = createMaker({
  account: makerAccount,
  feed,
  markets,
  config,
  refreshMs: env.MM_REFRESH_MS,
  staleMs: env.MM_STALE_MS,
});

const taker = env.TAKER_ENABLED
  ? createTaker({
      account: takerAccount,
      makerAccount,
      feed,
      markets,
      config,
      minMs: env.TAKER_MIN_MS,
      maxMs: env.TAKER_MAX_MS,
      notional: env.TAKER_NOTIONAL,
      slippagePct: env.TAKER_SLIPPAGE_PCT,
      staleMs: env.MM_STALE_MS,
    })
  : null;

maker.start();
taker?.start();

/**
 * Shutdown pulls the ladder, but it is not what makes a restart safe.
 *
 * `bun --watch` reloads do not reliably run these handlers, so the actual
 * safety net is that every maker cycle reconciles against
 * `GET /orders/open/:marketId` — a fresh process adopts whatever the previous
 * one left resting instead of quoting a second ladder on top of it.
 */
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[market-maker] ${signal} — pulling quotes`);
  taker?.stop();
  feed.stop();
  await maker.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
