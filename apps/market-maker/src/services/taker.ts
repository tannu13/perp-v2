import type { TMarketDto } from "@repo/shared";
import { ApiError } from "./api-client";
import type { BotAccount } from "./bot-account";
import type { MarketFeed } from "./market-feed";
import { effectiveLeverage, marginFor, roundQty, type LadderConfig, type Side } from "./quote-ladder";

/**
 * The taker: the only thing on this exchange that crosses the spread.
 *
 * It exists because a market maker cannot flatten its own inventory when it is
 * the only liquidity — see the header of `maker.ts`. Because this is a separate
 * account, the two bots are genuine counterparties, and one trade moves BOTH
 * toward flat: maker long 5 implies taker short 5, so the taker buying 3 leaves
 * the maker at +2 and the taker at −2 in a single fill.
 *
 * So its direction is biased toward whatever the maker is currently holding
 * (long maker → the taker buys, lifting the maker's ask), and when the maker is
 * flat it trades small and randomly. That random half is the point for the
 * demo: it is what keeps the trades tape ticking and drags `lastTradedPrice`
 * off the seed value and onto the index.
 */

const randomBetween = (low: number, high: number) =>
  low + Math.random() * (high - low);

/**
 * How strongly to lean against the maker's inventory.
 *
 * Floored at a coin flip so a flat book still gets two-sided noise, capped
 * below certainty so the tape never becomes a one-way ramp — a demo where every
 * print is a buy looks broken in a way an empty book does not.
 */
const offsetProbability = (normalisedInventory: number) =>
  0.5 + 0.45 * Math.min(1, Math.abs(normalisedInventory));

export const createTaker = ({
  account,
  makerAccount,
  feed,
  markets,
  config,
  minMs,
  maxMs,
  notional,
  slippagePct,
  staleMs,
}: {
  account: BotAccount;
  makerAccount: BotAccount;
  feed: MarketFeed;
  markets: TMarketDto[];
  config: LadderConfig;
  minMs: number;
  maxMs: number;
  notional: number;
  slippagePct: number;
  staleMs: number;
}) => {
  let running = false;
  let timer: Timer | null = null;

  const trade = async (market: TMarketDto) => {
    const anchor = feed.anchor(market.id, staleMs);
    if (!anchor) return;

    const snapshot = feed.snapshot(market.id);
    if (!snapshot?.depth) return;

    const makerInventory = await makerAccount.signedInventoryNotional(
      market.id,
      anchor,
    );
    const normalised = makerInventory / config.maxInventoryNotional;

    /**
     * The offsetting side is the SAME sign as the maker's inventory.
     *
     * Not the opposite — this is the sign that is easy to get backwards. The
     * maker being long means it needs to sell; the taker buying is what lets it.
     */
    const offsetSide: Side = makerInventory >= 0 ? "LONG" : "SHORT";
    const takeOffset = Math.random() < offsetProbability(normalised);
    const side: Side = takeOffset
      ? offsetSide
      : offsetSide === "LONG"
        ? "SHORT"
        : "LONG";

    /**
     * Size against what is actually resting, never against the config alone.
     *
     * `placeOrder` throws "There are no matches available" the moment the side
     * being hit is empty, and a market order larger than the book converts to a
     * resting limit at its slippage bound — which would leave the *taker*
     * quoting, quietly turning the noise generator into a second, much worse
     * market maker.
     */
    const book = side === "LONG" ? snapshot.depth.asks : snapshot.depth.bids;
    const reachable = book
      .slice(0, 2)
      .reduce((total, [, qty]) => total + Number(qty), 0);
    if (!(reachable > 0)) return;

    const touch = Number(book[0]?.[0]);
    if (!Number.isFinite(touch) || touch <= 0) return;

    const wanted = (notional * randomBetween(0.5, 1.5)) / touch;
    const qty = roundQty(Math.min(wanted, reachable * 0.9), market.sizeDecimals);
    if (!(qty > 0) || qty > reachable) return;

    /**
     * Margin, or deliberately none.
     *
     * The engine treats an order with no `initialMargin` as risk-reducing and
     * locks nothing — the same path a user's Close Position takes. But its test
     * is narrower than "opposite side": `placeOrder` throws "Margin required as
     * this is a risk increasing order" unless the order is opposite-side AND
     * `qty <= 2 * position.qty`. Omitting `equity` outside that window is a
     * rejected order, not a free one.
     */
    const positions = await account.openPositions(market.id);
    const position = positions[0];
    const reduces =
      position !== undefined &&
      position.type !== side &&
      qty <= 2 * position.qty;

    /**
     * The slippage-inflated price, not the touch.
     *
     * `placeOrder` overwrites the order's price with `best * (1 ± slippage%)`
     * BEFORE computing `price * qty / initialMargin` for the leverage check, so
     * margin sized off the raw touch understates the leverage the engine will
     * actually measure. There is headroom at 2x against BTC's cap of 8, but the
     * calculation should be right rather than lucky.
     */
    const worstPrice = touch * (1 + slippagePct / 100);
    const leverage = effectiveLeverage(config, market);

    const payload: Record<string, unknown> = {
      orderType: "market",
      market: market.slug,
      type: side,
      price: 0,
      qty: qty.toFixed(market.sizeDecimals),
      slippage: slippagePct,
    };
    if (!reduces) payload.equity = marginFor(worstPrice, qty, leverage);

    try {
      await account.client.post("/order", payload);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.message.includes("does not have available margin")) {
          await account.ensureFunds(true);
          return;
        }
        /**
         * Both of these are races against the maker's own reconcile cycle — it
         * cancels its ladder before replacing it, so a taker that read the
         * depth snapshot a moment earlier can arrive at an empty side. The next
         * tick is a few seconds away and the book will be back.
         */
        if (
          error.message.includes("no matches available") ||
          error.message.includes("Margin required")
        ) {
          return;
        }
      }
      console.warn(`[taker] ${market.slug} ${side} failed:`, describe(error));
    }
  };

  const schedule = () => {
    if (!running) return;
    timer = setTimeout(async () => {
      const market = markets[Math.floor(Math.random() * markets.length)];
      if (market) {
        try {
          await trade(market);
        } catch (error) {
          console.warn("[taker] cycle failed:", describe(error));
        }
      }
      schedule();
    }, randomBetween(minMs, maxMs));
  };

  return {
    start() {
      running = true;
      schedule();
      console.log(
        `[taker] crossing every ${minMs}-${maxMs}ms across ${markets.length} markets`,
      );
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
};

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
