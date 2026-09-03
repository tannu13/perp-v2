/**
 * The quote geometry. Pure, and deliberately the only part of this service that
 * is.
 *
 * Every other file here is I/O against a running exchange, where a mistake
 * shows up immediately as an HTTP error. A mistake in *this* file does not: a
 * ladder with the skew sign backwards, or with the two sides rounded so they
 * cross, places perfectly valid orders that quietly do the wrong thing. So it
 * takes numbers and returns numbers, and `quote-ladder.test.ts` pins the three
 * properties that have no other alarm.
 */

export type Side = "LONG" | "SHORT";

/** The subset of `MarketDtoSchema` the geometry actually needs. */
export type MarketSpec = {
  slug: string;
  priceDecimals: number;
  sizeDecimals: number;
  /** A string, like every price-shaped value in this system. */
  tickSize: string;
  maxLeverage: number;
};

export type LadderConfig = {
  levels: number;
  spreadBps: number;
  /** Target gap between rungs. Rounded to a whole number of ticks — see `gridSize`. */
  levelStepBps: number;
  skewBps: number;
  baseNotional: number;
  /**
   * Extra notional per level out from the touch. Costs churn — see
   * `buildLadder`, which is why it defaults to zero.
   */
  sizeGrowth: number;
  /** +/- fraction of the level's notional, applied deterministically per rung. */
  sizeJitter: number;
  leverage: number;
  requoteBps: number;
  maxInventoryNotional: number;
};

export type Quote = {
  side: Side;
  /** 0 is the inside of the book; higher is further away from the anchor. */
  level: number;
  price: number;
  qty: number;
  /** `equity` on the order payload — what the engine locks as initial margin. */
  margin: number;
  /**
   * How far a resting order may sit from `price` and still be this rung, in
   * price units. Carried on the quote because it is a property of the geometry
   * — the gaps either side of this level — and `reconcileLadder` has no other
   * way to know them once the steps stopped being uniform.
   */
  tolerance: number;
};

const BPS = 10_000;

/**
 * Floating-point slack for the tick division.
 *
 * `77908.2 / 0.1` is not exactly `779082` in binary floating point, and without
 * the nudge a price already sitting on a tick can floor a whole tick below
 * itself — which turns a stable quote into one that requotes every cycle.
 * A double carries ~16 significant digits, so at the ~1e6 step counts these
 * markets produce the real error is ~1e-10; 1e-9 clears it without ever being
 * large enough to cross a tick boundary of its own accord.
 */
const TICK_EPSILON = 1e-9;

export const floorToTick = (value: number, tick: number, decimals: number) =>
  Number((Math.floor(value / tick + TICK_EPSILON) * tick).toFixed(decimals));

export const ceilToTick = (value: number, tick: number, decimals: number) =>
  Number((Math.ceil(value / tick - TICK_EPSILON) * tick).toFixed(decimals));

/**
 * Quantity, rounded to the market's size precision.
 *
 * Rounds DOWN, then floors at one size increment. Down because a rounded-up
 * quantity is margin the bot did not budget for; the floor because a market
 * whose increment is coarser than the notional implies (a $10 order in BTC at
 * 4 decimals) would otherwise produce `0`, and a zero-quantity order is a 400
 * from `CreateOrderSchema` rather than a small order.
 */
export const roundQty = (qty: number, decimals: number) => {
  const step = 10 ** -decimals;
  const floored = Number((Math.floor(qty / step + TICK_EPSILON) * step).toFixed(decimals));
  return floored > 0 ? floored : Number(step.toFixed(decimals));
};

/**
 * Margin for one quote, rounded UP to cents.
 *
 * Up, not down, and not to full precision. The engine computes
 * `leverage = price * qty / initialMargin` and rejects anything above the
 * market's cap, so every rounding decision here has to move the effective
 * leverage *down*. Rounding to cents keeps the number the same shape as every
 * other money value that reaches Postgres.
 */
export const marginFor = (price: number, qty: number, leverage: number) =>
  Math.ceil((price * qty * 100) / leverage) / 100;

/** `min(configured, what this market allows)`. ETH caps at 3; BTC at 8. */
export const effectiveLeverage = (config: LadderConfig, market: MarketSpec) =>
  Math.min(config.leverage, market.maxLeverage);

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/**
 * Signed inventory, normalised to [-1, 1]. Positive is long.
 *
 * Notional rather than quantity so one number means the same thing in BTC and
 * in SOL, which is the same reason sizing is notional.
 */
export const normalisedInventory = (
  signedInventoryNotional: number,
  maxInventoryNotional: number,
) => clamp(signedInventoryNotional / maxInventoryNotional, -1, 1);

/**
 * The two reference prices the ladder grows out from.
 *
 * The skew term has opposite signs on the two sides, which is what makes it a
 * *shift* rather than a widening: the gap between `bidRef` and `askRef` is
 * `spreadBps` whatever the inventory is, so no amount of skew can invert the
 * book. Being long pushes both references down — the ask moves nearer the
 * market and is likelier to be lifted, the bid moves away and is likelier to be
 * missed. Getting that sign backwards builds a bot that accelerates into its
 * own inventory, and it looks identical from the outside until it blows up.
 */
export const referencePrices = (
  anchor: number,
  inventory: number,
  config: LadderConfig,
) => {
  const half = config.spreadBps / 2;
  const skew = inventory * config.skewBps;
  return {
    bidRef: anchor * (1 - (half + skew) / BPS),
    askRef: anchor * (1 + (half - skew) / BPS),
  };
};

/**
 * The absolute price grid the whole ladder sits on.
 *
 * This is the load-bearing decision in the file, and it is about churn, not
 * looks. An anchor-relative ladder — rung `i` at `ref * (1 - i * step)` — moves
 * *every* rung whenever the index moves, so a book of twenty levels a side
 * across three markets rewrites all 120 orders on essentially every cycle.
 * Measured: 5227 `orders` inserts a minute, against 105 for the five-level
 * version, and depth frames caught mid-rebuild showing 20x3 and 4x20 books.
 *
 * On a fixed grid the desired prices do not move at all while the reference
 * price stays inside its grid cell, and when it crosses one they all shift by
 * exactly one cell — so nineteen of the twenty rungs land on a price that
 * already has the bot's order resting on it, and are adopted at distance zero.
 * A shift costs one cancel and one place per side instead of forty. It is also
 * precisely what a real book looks like as it moves: a level appears at the
 * touch and one drops off the tail, rather than the whole ladder teleporting.
 *
 * That property is why the gaps are uniform. An expanding ladder — dense at the
 * touch, thin at the tail — is the nicer shape and was the first attempt, but
 * under it a one-cell shift lands every rung between two old prices and nothing
 * can be adopted, which is the anchor-relative cost all over again.
 *
 * Rounded to a whole number of ticks, and never below one: on SOL a tick is
 * already a whole basis point, so the requested step is finer than the grid the
 * price can even be expressed on, and the ladder falls back to quoting every
 * tick rather than collapsing several rungs onto one price.
 *
 * Sized from the anchor's ORDER OF MAGNITUDE rather than the anchor, which
 * matters more than it looks. A grid computed straight off the price is not
 * stable against the price: ETH at 2500 wants 12.5 ticks, which rounds to 13,
 * and thirteen cents lower it wants 12.49, which rounds to 12 — so the entire
 * grid moves, nothing can be adopted, and a routine one-cell scroll costs a
 * 40-order rebuild. That is not a corner case; it is wherever the rounding
 * happens to sit near a half tick, and the test suite found it immediately.
 *
 * Snapping to the nearest octave puts the boundaries a factor of two apart
 * instead of a fraction of a tick, so a market would have to hover on exactly
 * one to make the grid flicker, and the grid it produces is within √2 of the
 * requested step — well inside the precision a cosmetic level spacing needs.
 */
export const gridSize = (
  anchor: number,
  market: MarketSpec,
  config: LadderConfig,
) => {
  const tick = Number(market.tickSize);
  const octave = 2 ** Math.round(Math.log2(anchor));
  const wanted = (octave * config.levelStepBps) / BPS;
  const ticks = Math.max(1, Math.round(wanted / tick));
  return Number((ticks * tick).toFixed(market.priceDecimals));
};

/**
 * The largest share of the gap to its nearest neighbour that a quote may drift
 * and still be recognised as its rung.
 *
 * Under a half, necessarily. `reconcileLadder` identifies a resting order with
 * the desired rung it is nearest to, and a tolerance of half a gap or more
 * means an order sitting exactly between two rungs is an equally good match for
 * both — which is how the ladder started walking one rung per fill and
 * eventually put two orders on one price. Under a half, "nearest" has exactly
 * one answer.
 */
const MAX_TOLERANCE_OF_STEP = 0.45;

/**
 * How far a resting quote may drift before it is worth replacing.
 *
 * Two bounds, and the tighter one wins. `MM_REQUOTE_BPS` says how stale a price
 * is allowed to be in its own right; the grid cell says how stale it *can* be
 * before the reconcile can no longer tell which rung it is.
 *
 * On a grid this mostly does not arise — a rung the ladder still wants is
 * matched at distance exactly zero, and one it no longer wants is a whole cell
 * away — so what the tolerance really governs is the leftovers: orders resting
 * from a previous grid size, a previous config, or a process that quoted a
 * different ladder. Those are off-grid, further than the bound, and get
 * replaced, which is what should happen to them.
 *
 * There is deliberately no one-tick floor. On SOL a grid cell IS one tick, so a
 * floor there would push the tolerance up to the whole cell and bring back the
 * walking bug the bound exists to prevent. It is also unnecessary:
 * `floorToTick` is deterministic (see `TICK_EPSILON`), so an unmoved rung sits
 * at distance zero and is adopted however small the tolerance is.
 */
export const requoteTolerance = ({
  price,
  gap,
  config,
}: {
  price: number;
  /** Distance to the nearest neighbouring rung, in price units. */
  gap: number;
  config: LadderConfig;
}) => Math.min((price * config.requoteBps) / BPS, MAX_TOLERANCE_OF_STEP * gap);

/**
 * A stable size multiplier in `[1 - jitter, 1 + jitter]`, keyed by PRICE.
 *
 * A book whose sizes are a perfectly linear ramp reads as generated at a
 * glance, and that was most of what made the depth ladder look synthetic.
 *
 * Keyed by the grid cell rather than by the level, which is not cosmetic. The
 * ladder scrolls: when the book shifts a cell, rung 3 takes over the price rung
 * 4 was resting on, and a level-keyed jitter would want a different size there
 * — a swing of up to twice `sizeJitter`, straight through
 * `SIZE_DRIFT_TOLERANCE`, requoting all twenty rungs on a shift that should
 * have cost one. Keyed by price the resting order is already the right size, so
 * the raggedness scrolls with the book. Which is also how a real book behaves:
 * the depth belongs to the price, not to its rank.
 *
 * Hashed rather than drawn for the same reason at a shorter timescale — a
 * random draw per cycle would move every size on a book that had not changed.
 */
export const sizeMultiplier = (
  market: MarketSpec,
  side: Side,
  gridIndex: number,
  jitter: number,
) => {
  if (!jitter) return 1;
  const seed = `${market.slug}:${side}:${gridIndex}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const unit = ((hash >>> 0) % 100_000) / 100_000;
  return 1 + jitter * (2 * unit - 1);
};

/**
 * The desired resting orders for one market.
 *
 * `signedInventoryNotional` is positive when the bot is long. Returns bids
 * (LONG) inside-out followed by asks (SHORT) inside-out.
 */
export const buildLadder = ({
  anchor,
  signedInventoryNotional,
  market,
  config,
}: {
  anchor: number;
  signedInventoryNotional: number;
  market: MarketSpec;
  config: LadderConfig;
}): Quote[] => {
  const leverage = effectiveLeverage(config, market);
  const inventory = normalisedInventory(
    signedInventoryNotional,
    config.maxInventoryNotional,
  );
  const { bidRef, askRef } = referencePrices(anchor, inventory, config);
  const grid = gridSize(anchor, market, config);

  /**
   * The touch is the reference snapped OUTWARDS onto the grid — bids down,
   * asks up, the same direction the tick rounding already went.
   *
   * Outwards on both sides is what keeps the book uncrossed for free. The two
   * references cannot be equal (the spread is positive), so the highest grid
   * cell at or below `bidRef` is strictly below the lowest at or above
   * `askRef`, whatever the skew has done to them.
   */
  const touch = {
    LONG: floorToTick(bidRef, grid, market.priceDecimals),
    SHORT: ceilToTick(askRef, grid, market.priceDecimals),
  } as const;

  const quotes: Quote[] = [];

  for (const side of ["LONG", "SHORT"] as const) {
    const direction = side === "LONG" ? -1 : 1;

    for (let level = 0; level < config.levels; level += 1) {
      const price = Number(
        (touch[side] + direction * level * grid).toFixed(market.priceDecimals),
      );
      // A ladder deep enough to reach zero only happens on a nonsense anchor,
      // but a negative price is a 400 from the order schema, not a small order.
      if (price <= 0) continue;

      /**
       * `sizeGrowth` is a level term on a ladder that scrolls, and those two
       * facts fight: an order does not move when the book does, so its level
       * creeps outward and the size the ladder wants there creeps with it.
       * Under `SIZE_DRIFT_TOLERANCE` that is silent for a while and then
       * requotes a batch of rungs — at 0.12 a level, every third cell of
       * one-way drift. Hence the default of zero, which is also the more
       * faithful model: in a real book the depth belongs to the price, and an
       * order does not resize because the market walked away from it. The
       * variation that makes the ladder look like a book comes from
       * `sizeJitter`, which is keyed by price and therefore free.
       */
      const notional =
        config.baseNotional *
        (1 + level * config.sizeGrowth) *
        sizeMultiplier(market, side, Math.round(price / grid), config.sizeJitter);
      const qty = roundQty(notional / price, market.sizeDecimals);

      quotes.push({
        side,
        level,
        price,
        qty,
        margin: marginFor(price, qty, leverage),
        tolerance: requoteTolerance({ price, gap: grid, config }),
      });
    }
  }

  return quotes;
};

/** A resting order, reduced to what the diff needs. */
export type Resting = {
  id: string;
  side: Side;
  price: number;
  /** `qty - filledQty` — what is actually left on the book. */
  remainingQty: number;
};

/**
 * How far a resting quote's SIZE may drift before it is worth replacing. A
 * partial fill is the case this exists for: the rung is still at the right
 * price with the wrong depth behind it.
 */
const SIZE_DRIFT_TOLERANCE = 0.25;

const bySide = (orders: Resting[], side: Side) =>
  orders
    .filter((order) => order.side === side)
    .sort((a, b) => (side === "LONG" ? b.price - a.price : a.price - b.price));

/**
 * What to cancel and what to place to turn `resting` into `desired`.
 *
 * Pure, and here rather than inside the loop that calls it because getting it
 * wrong is silent: every order it produces is valid, accepted by the engine,
 * and wrong only in aggregate. The first version of this matched resting orders
 * to rungs by RANK — sort both inside-out and pair them off — which read as
 * obviously equivalent and was not. See the comment on the matching loop.
 */
export const reconcileLadder = ({
  desired,
  resting,
}: {
  desired: Quote[];
  resting: Resting[];
}): { toCancel: Resting[]; toPlace: Quote[] } => {
  const toCancel: Resting[] = [];
  const toPlace: Quote[] = [];

  for (const side of ["LONG", "SHORT"] as const) {
    /**
     * Resting orders are matched to desired rungs by PRICE, not by rank.
     *
     * The moment one rung fills and the ranks shift up, rank matching pairs
     * desired level 0 with the order that used to be level 1 — a whole step
     * away, but still the first in the list — and adopts it. The ladder then
     * walks: rungs drift off their intended prices, and once two adopted orders
     * sit a step apart a later cycle places a fresh order at a price an adopted
     * one already occupies.
     *
     * That is not theoretical. It produced two identical 0.554 ETH bids at
     * 2435.77 and a depth response showing four bid levels where five orders
     * were resting — the engine aggregates by price, so the fifth rung simply
     * vanished into the fourth.
     *
     * Nearest-price matching cannot do that: a resting order is only ever
     * identified with the rung it is actually closest to. Matching inside-out
     * means the levels a taker will actually reach claim first.
     */
    const available = bySide(resting, side);
    const desiredSide = desired.filter((quote) => quote.side === side);
    const adoptedPrices = new Set<number>();
    const pending: Quote[] = [];

    for (const quote of desiredSide) {
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const [index, order] of available.entries()) {
        const distance = Math.abs(order.price - quote.price);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }

      const candidate = bestIndex >= 0 ? available[bestIndex] : undefined;
      if (!candidate || bestDistance > quote.tolerance) {
        pending.push(quote);
        continue;
      }

      available.splice(bestIndex, 1);
      const sizeDrift =
        Math.abs(candidate.remainingQty - quote.qty) / Math.max(quote.qty, 1e-9);

      if (sizeDrift > SIZE_DRIFT_TOLERANCE) {
        toCancel.push(candidate);
        pending.push(quote);
      } else {
        adoptedPrices.add(candidate.price);
      }
    }

    // Rungs the ladder no longer has: a shrunken `MM_LEVELS`, leftovers from a
    // process that ran a different config, or orders too far from every desired
    // price to be adopted.
    toCancel.push(...available);

    /**
     * Never place onto a price an adopted order already holds.
     *
     * The engine keys its book by price, so a collision is not two rungs — it
     * is one rung of double the size and a ladder one level short. Skipping
     * leaves a gap for a single cycle, which the next reconcile fills.
     */
    toPlace.push(...pending.filter((quote) => !adoptedPrices.has(quote.price)));
  }

  return { toCancel, toPlace };
};
