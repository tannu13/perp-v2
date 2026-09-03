import type { TMarketDto } from "@repo/shared";
import { ApiError } from "./api-client";
import type { BotAccount } from "./bot-account";
import type { MarketFeed } from "./market-feed";
import {
  buildLadder,
  reconcileLadder,
  type LadderConfig,
  type Quote,
  type Resting,
  type Side,
} from "./quote-ladder";

/**
 * The maker: a two-sided ladder that only ever rests.
 *
 * **It never crosses, and that is the load-bearing rule of this whole service.**
 * The only liquidity on the book is its own, so a market order to flatten would
 * be a self-trade: longer as maker and shorter as taker in the same fill, net
 * position unchanged. The engine permits it — `fill-view.ts` and
 * `userEventsForMatch` both handle an account on both sides of one trade — it
 * simply achieves nothing. So the maker controls inventory *passively*, by
 * skewing its quotes, and `taker.ts` (a separate account, therefore a real
 * counterparty) is what actually moves the position.
 */

/** An order as `GET /orders/open/:marketId` returns it — a raw `orders` row. */
type OpenOrder = {
  id: string;
  marketId: string;
  positionType: Side;
  orderType: string;
  status: string;
  qty: string;
  filledQty: string;
  price: string;
  initialMargin: string;
};

const toResting = (order: OpenOrder): Resting => ({
  id: order.id,
  side: order.positionType,
  /**
   * `Number`, deliberately.
   *
   * Postgres hands prices back as strings and the engine keys its book with
   * `${Number(price)}`, so "78000.00" and "78000" are the same level there and
   * must be the same level here. Comparing the strings would make every quote
   * look stale and requote the entire ladder every cycle.
   */
  price: Number(order.price),
  remainingQty: Number(order.qty) - Number(order.filledQty),
});

export const createMaker = ({
  account,
  feed,
  markets,
  config,
  refreshMs,
  staleMs,
}: {
  account: BotAccount;
  feed: MarketFeed;
  markets: TMarketDto[];
  config: LadderConfig;
  refreshMs: number;
  staleMs: number;
}) => {
  let running = false;
  const timers: Timer[] = [];
  /** One "anchor is stale" line per outage, not one per cycle. */
  const staleSince = new Map<string, number>();

  const openOrders = async (marketId: string) => {
    const body = await account.client.get<{ orders: OpenOrder[] }>(
      `/orders/open/${marketId}`,
    );
    return (body.orders ?? []).map(toResting);
  };

  const cancel = async (order: Resting) => {
    try {
      await account.client.del(`/order/${order.id}`);
    } catch (error) {
      /**
       * A cancel that misses is not a problem worth a log line: between the
       * read and the delete the taker may have filled the order, and the next
       * cycle re-reads the book anyway. Reconciliation is the recovery
       * mechanism, so nothing here needs to be transactional.
       *
       * It arrives as TWO different failures and both are this same race.
       * A 404 is `cancelOrder` not finding the row for this user. A 400
       * carrying "Order not found" is the row still existing while the ENGINE
       * has already retired it — `order-service.ts` looks the row up in
       * Postgres first and only then asks the engine, so a fill landing
       * between those two steps produces exactly this.
       */
      if (error instanceof ApiError) {
        if (error.status === 404) return;
        if (error.message.includes("not found")) return;
      }
      console.warn(`[maker] cancel ${order.id} failed:`, describe(error));
    }
  };

  const place = async (market: TMarketDto, quote: Quote) => {
    try {
      await account.client.post("/order", {
        orderType: "limit",
        market: market.slug,
        type: quote.side,
        price: quote.price.toFixed(market.priceDecimals),
        qty: quote.qty.toFixed(market.sizeDecimals),
        slippage: 0,
        equity: quote.margin,
      });
      return true;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.message.includes("does not have available margin")
      ) {
        await account.ensureFunds(true);
        return false;
      }
      console.warn(
        `[maker] place ${market.slug} ${quote.side} @ ${quote.price} failed:`,
        describe(error),
      );
      return false;
    }
  };

  const cancelAll = async (marketId: string) => {
    const resting = await openOrders(marketId);
    await Promise.all(resting.map(cancel));
    return resting.length;
  };

  const cycle = async (market: TMarketDto) => {
    const anchor = feed.anchor(market.id, staleMs);

    if (!anchor) {
      if (!staleSince.has(market.id)) {
        staleSince.set(market.id, Date.now());
        /**
         * Two different situations, and conflating them cost a confusing first
         * run: no frame has EVER arrived (the socket is still opening, which is
         * the normal first second or two of a boot), versus one arrived and
         * then stopped. Only the second is worth pointing at price-poller.
         */
        const everSeen = feed.snapshot(market.id)?.indexPrice != null;
        console.warn(
          everSeen
            ? `[maker] ${market.slug}: no mark-price within ${staleMs}ms — pulling quotes. ` +
                `Check apps/price-poller: its Binance socket stalls silently and the ` +
                `engine then answers every spot_price_update with "Unsupported request type".`
            : `[maker] ${market.slug}: waiting for the first mark-price frame`,
        );
      }
      const pulled = await cancelAll(market.id);
      if (pulled) console.warn(`[maker] ${market.slug}: pulled ${pulled} orders`);
      return;
    }

    if (staleSince.delete(market.id)) {
      console.log(`[maker] ${market.slug}: anchor is back at ${anchor}`);
    }

    const [resting, inventory] = await Promise.all([
      openOrders(market.id),
      account.signedInventoryNotional(market.id, anchor),
    ]);

    const desired = buildLadder({
      anchor,
      signedInventoryNotional: inventory,
      market,
      config,
    });

    const { toCancel, toPlace } = reconcileLadder({ desired, resting });

    if (!toCancel.length && !toPlace.length) return;

    /**
     * Cancel only what the new quotes would trade against; place; then cancel
     * the rest.
     *
     * The previous version cancelled the entire diff before placing any of it,
     * because the bot is the only counterparty on this book and a new bid
     * resting above a stale ask of its own is a self-cross, not a theoretical
     * one. That reasoning is right and is kept — but it was applied to every
     * replacement rather than to the ones that could actually cross, and the
     * cost was visible on the wire: `depth` frames captured mid-cycle showed
     * 4x5 and 5x4 books a hundred milliseconds apart, so a rung that was merely
     * drifting a tick vanished from the ladder and came back. That flicker is
     * what made the book look broken rather than busy.
     *
     * A cross needs a resting order on the OPPOSITE side at or through the new
     * price, so that is the only set that has to go first. Everything else is
     * replaced while its old order is still resting: the book briefly carries
     * an extra rung instead of briefly missing one, and a duplicate level is
     * invisible where a hole is not.
     *
     * The test is run against every resting order rather than just the ones
     * being replaced, because an *adopted* order is also a live order. In
     * practice it never matches — the spread is far wider than the tolerance a
     * rung is adopted within — but "in practice" is not the same as checked,
     * and the failure it would guard against is a self-trade.
     */
    const highestNewBid = Math.max(
      ...toPlace.filter((quote) => quote.side === "LONG").map((q) => q.price),
      Number.NEGATIVE_INFINITY,
    );
    const lowestNewAsk = Math.min(
      ...toPlace.filter((quote) => quote.side === "SHORT").map((q) => q.price),
      Number.POSITIVE_INFINITY,
    );
    const crosses = (order: Resting) =>
      order.side === "LONG"
        ? order.price >= lowestNewAsk
        : order.price <= highestNewBid;

    const crossing = resting.filter(crosses);
    const crossingIds = new Set(crossing.map((order) => order.id));

    await Promise.all(crossing.map(cancel));
    if (!running) return;

    /**
     * Placed together, not one after another. Twenty sequential round trips is
     * a fifth of a second in which the ladder is half old and half new, and
     * ws-server publishes market state every 100ms — so the book was being
     * broadcast mid-rebuild. `api-client`'s gate caps the real concurrency, and
     * the whole batch now lands inside one publish window.
     */
    await Promise.all(toPlace.map((quote) => place(market, quote)));
    await Promise.all(
      toCancel.filter((order) => !crossingIds.has(order.id)).map(cancel),
    );
  };

  const loop = (market: TMarketDto) => {
    const tick = async () => {
      if (!running) return;
      try {
        await cycle(market);
      } catch (error) {
        console.warn(`[maker] ${market.slug} cycle failed:`, describe(error));
      }
      if (running) timers.push(setTimeout(tick, refreshMs));
    };
    void tick();
  };

  return {
    start() {
      running = true;
      for (const market of markets) loop(market);
      console.log(
        `[maker] quoting ${markets.map((m) => m.slug).join(", ")} — ` +
          `${config.levels} levels, ${config.spreadBps}bps spread, every ${refreshMs}ms`,
      );
    },
    async stop() {
      running = false;
      for (const timer of timers) clearTimeout(timer);
      /**
       * Best-effort. `bun --watch` does not reliably run this on reload, which
       * is why the real safety net is that every cycle reconciles against
       * `GET /orders/open/:marketId` rather than against local state — a
       * restarted process adopts the previous one's ladder instead of doubling
       * it.
       */
      const pulled = await Promise.all(
        markets.map((market) => cancelAll(market.id).catch(() => 0)),
      );
      const total = pulled.reduce((sum, count) => sum + count, 0);
      if (total) console.log(`[maker] cancelled ${total} resting orders`);
    },
  };
};

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
