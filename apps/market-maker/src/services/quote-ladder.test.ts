import { describe, expect, it } from "bun:test";
import {
  buildLadder,
  ceilToTick,
  effectiveLeverage,
  floorToTick,
  marginFor,
  normalisedInventory,
  referencePrices,
  reconcileLadder,
  gridSize,
  requoteTolerance,
  roundQty,
  sizeMultiplier,
  type LadderConfig,
  type MarketSpec,
} from "./quote-ladder";

/** The three real markets, copied from `packages/db/src/markets.ts`. */
const BTC: MarketSpec = {
  slug: "BTC-USD",
  priceDecimals: 1,
  sizeDecimals: 4,
  tickSize: "0.1",
  maxLeverage: 8,
};
const ETH: MarketSpec = {
  slug: "ETH-USD",
  priceDecimals: 2,
  sizeDecimals: 3,
  tickSize: "0.01",
  maxLeverage: 3,
};
const SOL: MarketSpec = {
  slug: "SOL-USD",
  priceDecimals: 2,
  sizeDecimals: 2,
  tickSize: "0.01",
  maxLeverage: 30,
};

/**
 * Uniform steps and no jitter — the geometry reduced to the part each test is
 * about. `production` below is the shipped shape, and the invariants that have
 * to hold there are asserted against it by name.
 */
const config: LadderConfig = {
  levels: 5,
  spreadBps: 8,
  levelStepBps: 10,
  skewBps: 8,
  baseNotional: 1000,
  sizeGrowth: 0.35,
  sizeJitter: 0,
  leverage: 2,
  requoteBps: 3,
  maxInventoryNotional: 20_000,
};

/** `.env.example`, so the defaults are covered rather than only a toy config. */
const production: LadderConfig = {
  levels: 20,
  spreadBps: 2,
  levelStepBps: 0.5,
  skewBps: 3,
  baseNotional: 900,
  sizeGrowth: 0,
  sizeJitter: 0.5,
  leverage: 2,
  requoteBps: 3,
  maxInventoryNotional: 20_000,
};

const bids = (quotes: ReturnType<typeof buildLadder>) =>
  quotes.filter((quote) => quote.side === "LONG");
const asks = (quotes: ReturnType<typeof buildLadder>) =>
  quotes.filter((quote) => quote.side === "SHORT");

describe("tick rounding", () => {
  it("floors bids and ceils asks onto the grid", () => {
    expect(floorToTick(77_908.26, 0.1, 1)).toBe(77_908.2);
    expect(ceilToTick(77_908.26, 0.1, 1)).toBe(77_908.3);
  });

  it("leaves a price already on the grid alone in both directions", () => {
    // The floating-point case: 77908.2 / 0.1 is not exactly 779082.
    expect(floorToTick(77_908.2, 0.1, 1)).toBe(77_908.2);
    expect(ceilToTick(77_908.2, 0.1, 1)).toBe(77_908.2);
    expect(floorToTick(203.45, 0.01, 2)).toBe(203.45);
    expect(ceilToTick(203.45, 0.01, 2)).toBe(203.45);
  });
});

describe("roundQty", () => {
  it("rounds down to the market's size precision", () => {
    expect(roundQty(1000 / 78_000, BTC.sizeDecimals)).toBe(0.0128);
    expect(roundQty(1000 / 2_500, ETH.sizeDecimals)).toBe(0.4);
    expect(roundQty(1000 / 203.45, SOL.sizeDecimals)).toBe(4.91);
  });

  it("never returns zero, so the order schema is never handed a 0 qty", () => {
    expect(roundQty(0.000001, BTC.sizeDecimals)).toBe(0.0001);
  });
});

describe("leverage", () => {
  it("clamps to the market's cap — ETH allows only 3", () => {
    expect(effectiveLeverage({ ...config, leverage: 10 }, ETH)).toBe(3);
    expect(effectiveLeverage({ ...config, leverage: 10 }, BTC)).toBe(8);
    expect(effectiveLeverage(config, SOL)).toBe(2);
  });

  it("rounds margin up, so effective leverage lands under the cap not over", () => {
    const margin = marginFor(77_908.2, 0.0128, 2);
    expect(margin).toBe(498.62);
    expect((77_908.2 * 0.0128) / margin).toBeLessThanOrEqual(2);
  });

  it("keeps every quote's implied leverage within the market cap", () => {
    for (const market of [BTC, ETH, SOL]) {
      const anchor = market === BTC ? 78_000 : market === ETH ? 2_500 : 203.45;
      for (const quote of buildLadder({
        anchor,
        signedInventoryNotional: 0,
        market,
        config,
      })) {
        const implied = (quote.price * quote.qty) / quote.margin;
        expect(implied).toBeLessThanOrEqual(market.maxLeverage);
      }
    }
  });
});

describe("normalisedInventory", () => {
  it("clamps to [-1, 1] so an extreme position cannot run the skew away", () => {
    expect(normalisedInventory(200_000, 20_000)).toBe(1);
    expect(normalisedInventory(-200_000, 20_000)).toBe(-1);
    expect(normalisedInventory(10_000, 20_000)).toBe(0.5);
  });
});

describe("skew direction", () => {
  /**
   * The property with no other alarm: a long bot must quote LOWER, bringing its
   * ask nearer the market so it is likelier to be lifted and its position
   * likelier to shrink. The opposite sign is a bot that buys harder the longer
   * it gets, and nothing about the orders it places looks wrong.
   */
  it("being long pushes the whole ladder down", () => {
    const flat = referencePrices(78_000, 0, config);
    const long = referencePrices(78_000, 1, config);
    const short = referencePrices(78_000, -1, config);

    expect(long.bidRef).toBeLessThan(flat.bidRef);
    expect(long.askRef).toBeLessThan(flat.askRef);
    expect(short.bidRef).toBeGreaterThan(flat.bidRef);
    expect(short.askRef).toBeGreaterThan(flat.askRef);
  });

  it("shifts the ladder without widening it — the gap stays the spread", () => {
    for (const inventory of [-1, -0.5, 0, 0.5, 1]) {
      const { bidRef, askRef } = referencePrices(78_000, inventory, config);
      expect((askRef - bidRef) / 78_000).toBeCloseTo(config.spreadBps / 1e4, 10);
    }
  });
});

describe("buildLadder", () => {
  it("is never crossed, at any inventory, on any market", () => {
    for (const [market, anchor] of [
      [BTC, 78_000],
      [ETH, 2_500],
      [SOL, 203.45],
    ] as const) {
      for (const inventory of [-40_000, -20_000, -1, 0, 1, 20_000, 40_000]) {
        for (const shape of [config, production]) {
          const quotes = buildLadder({
            anchor,
            signedInventoryNotional: inventory,
            market,
            config: shape,
          });
          expect(bids(quotes)[0]!.price).toBeLessThan(asks(quotes)[0]!.price);
        }
      }
    }
  });

  it("produces strictly monotonic, distinct levels on both sides", () => {
    const quotes = buildLadder({
      anchor: 203.45,
      signedInventoryNotional: 0,
      market: SOL,
      config,
    });
    const bidPrices = bids(quotes).map((quote) => quote.price);
    const askPrices = asks(quotes).map((quote) => quote.price);

    expect(bidPrices).toHaveLength(config.levels);
    expect(new Set(bidPrices).size).toBe(config.levels);
    expect(new Set(askPrices).size).toBe(config.levels);
    for (let i = 1; i < config.levels; i += 1) {
      expect(bidPrices[i]!).toBeLessThan(bidPrices[i - 1]!);
      expect(askPrices[i]!).toBeGreaterThan(askPrices[i - 1]!);
    }
  });

  it("keeps levels distinct even when the step is finer than the tick", () => {
    // A step of 0.01bps on SOL is ~0.0002 — well under the 0.01 tick, so the
    // rounding would collapse every level onto one price without the guard.
    const quotes = buildLadder({
      anchor: 203.45,
      signedInventoryNotional: 0,
      market: SOL,
      config: { ...config, levelStepBps: 0.01 },
    });
    expect(new Set(bids(quotes).map((q) => q.price)).size).toBe(config.levels);
    expect(new Set(asks(quotes).map((q) => q.price)).size).toBe(config.levels);
  });

  it("grows size with distance and sits on the market's size grid", () => {
    const quotes = buildLadder({
      anchor: 78_000,
      signedInventoryNotional: 0,
      market: BTC,
      config,
    });
    const sizes = bids(quotes).map((quote) => quote.qty);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!);
    }
    for (const quote of quotes) {
      expect(quote.qty).toBe(Number(quote.qty.toFixed(BTC.sizeDecimals)));
      expect(quote.price).toBe(Number(quote.price.toFixed(BTC.priceDecimals)));
    }
  });

  /**
   * The reason jitter is hashed rather than drawn: a size that moved every
   * cycle would exceed `SIZE_DRIFT_TOLERANCE` on a book that had not changed
   * and requote the entire ladder on nothing at all.
   */
  it("jitters size identically on every call, so a still book stays still", () => {
    const build = () =>
      buildLadder({
        anchor: 78_000,
        signedInventoryNotional: 0,
        market: BTC,
        config: production,
      }).map((quote) => quote.qty);
    expect(build()).toEqual(build());
  });

  it("jitters size without making it uniform or unbounded", () => {
    const quotes = buildLadder({
      anchor: 78_000,
      signedInventoryNotional: 0,
      market: BTC,
      config: production,
    });
    const plain = buildLadder({
      anchor: 78_000,
      signedInventoryNotional: 0,
      market: BTC,
      config: { ...production, sizeJitter: 0 },
    });

    // Ragged: the ramp is gone.
    const sizes = bids(quotes).map((quote) => quote.qty);
    const rising = sizes.filter((size, i) => i > 0 && size > sizes[i - 1]!);
    expect(rising.length).toBeLessThan(sizes.length - 1);

    // But bounded, so no rung is silently ten times its neighbour.
    for (const [index, quote] of quotes.entries()) {
      const ratio = quote.qty / plain[index]!.qty;
      expect(ratio).toBeGreaterThan(1 - production.sizeJitter - 0.01);
      expect(ratio).toBeLessThan(1 + production.sizeJitter + 0.01);
    }
  });

  it("keeps sizeMultiplier inside the band and off a constant", () => {
    const values = [0, 1, 2, 3, 4].map((level) =>
      sizeMultiplier(BTC, "LONG", level, 0.35),
    );
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0.65);
      expect(value).toBeLessThanOrEqual(1.35);
    }
    expect(new Set(values).size).toBeGreaterThan(1);
    expect(sizeMultiplier(BTC, "LONG", 0, 0)).toBe(1);
    expect(sizeMultiplier(BTC, "LONG", 0, 0.35)).not.toBe(
      sizeMultiplier(BTC, "SHORT", 0, 0.35),
    );
  });

  it("brackets the anchor when flat", () => {
    const quotes = buildLadder({
      anchor: 78_000,
      signedInventoryNotional: 0,
      market: BTC,
      config,
    });
    expect(bids(quotes)[0]!.price).toBeLessThan(78_000);
    expect(asks(quotes)[0]!.price).toBeGreaterThan(78_000);
  });
});

describe("gridSize", () => {
  it("rounds the requested step to whole ticks", () => {
    // 78000 rounds to the 65536 octave; 65536 * 0.5bps = 3.2768, tick 0.1.
    expect(gridSize(78_000, BTC, production)).toBe(3.3);
    // 2500 rounds to 2048; 2048 * 0.5bps = 0.1024, tick 0.01.
    expect(gridSize(2_500, ETH, production)).toBe(0.1);
  });

  it("never goes below one tick, however fine the step asks to be", () => {
    // A tick is already a whole basis point on SOL, so 0.5bps is sub-tick.
    expect(gridSize(203.45, SOL, production)).toBe(0.01);
    expect(gridSize(203.45, SOL, { ...production, levelStepBps: 0.001 })).toBe(0.01);
  });

  /**
   * The regression. A grid sized off the price itself lands on a rounding
   * boundary somewhere in every market, and a rebuild there costs every order
   * on the book.
   */
  it("does not move when the price moves", () => {
    for (const [market, anchor] of [
      [BTC, 78_000],
      [ETH, 2_500],
      [SOL, 203.45],
    ] as const) {
      const grid = gridSize(anchor, market, production);
      for (let step = -200; step <= 200; step += 1) {
        expect(gridSize(anchor + step * grid, market, production)).toBe(grid);
      }
    }
  });
});

describe("requoteTolerance", () => {
  it("is bounded by the neighbour gap, so outer rungs sit still through chop", () => {
    const inner = requoteTolerance({ price: 78_000, gap: 3, config });
    const outer = requoteTolerance({ price: 78_000, gap: 300, config });
    expect(outer).toBeGreaterThan(inner);
  });

  it("never lets a rung drift onto its neighbour, whatever MM_REQUOTE_BPS says", () => {
    for (const requoteBps of [1, 3, 10, 100]) {
      for (const gap of [0.1, 1, 10, 500]) {
        const tolerance = requoteTolerance({
          price: 78_000,
          gap,
          config: { ...config, requoteBps },
        });
        expect(tolerance).toBeLessThan(gap / 2);
      }
    }
  });
});

/**
 * The invariant `reconcileLadder` depends on, asserted end to end rather than
 * on the helper: if a rung may drift half the way to its neighbour, an order
 * between the two matches both equally well and "nearest" stops being an
 * answer. It has to hold on the REALISED ladder, because tick rounding moves
 * rungs around — on SOL a tick is a whole basis point, so the inner gaps get
 * clamped up to a tick and are not the gaps `levelOffsets` asked for.
 */
describe("ladder tolerances", () => {
  it("stay under half the realised gap on every market and both sides", () => {
    for (const [market, anchor] of [
      [BTC, 78_000],
      [ETH, 2_500],
      [SOL, 203.45],
    ] as const) {
      for (const inventory of [-40_000, 0, 40_000]) {
        const quotes = buildLadder({
          anchor,
          signedInventoryNotional: inventory,
          market,
          config: production,
        });

        for (const side of [bids(quotes), asks(quotes)]) {
          for (const [index, quote] of side.entries()) {
            for (const neighbour of [side[index - 1], side[index + 1]]) {
              if (!neighbour) continue;
              const gap = Math.abs(neighbour.price - quote.price);
              expect(gap).toBeGreaterThan(0);
              expect(quote.tolerance).toBeLessThan(gap / 2);
            }
          }
        }
      }
    }
  });

  /**
   * The grid is uniform, so every rung has the same bound. Worth pinning: the
   * whole cheap-scroll property rests on a shifted ladder landing exactly on
   * prices it already occupies, and a per-level bound would mean a rung
   * adopting a neighbour's order at a distance its own bound rejected.
   */
  it("are identical across the ladder, because the grid is", () => {
    const quotes = buildLadder({
      anchor: 78_000,
      signedInventoryNotional: 0,
      market: BTC,
      config: production,
    });
    expect(new Set(quotes.map((quote) => quote.tolerance)).size).toBe(1);
  });
});

/**
 * The property the whole grid exists for, and the one with no other alarm: it
 * is invisible from the outside whether a shifted ladder reuses its orders or
 * rewrites them. Getting it wrong is not an error, it is 5227 `orders` inserts
 * a minute and a book that is caught half-rebuilt on the wire.
 */
describe("scrolling the ladder", () => {
  const asResting = (quotes: ReturnType<typeof buildLadder>) =>
    quotes.map((quote, index) => ({
      id: `order-${index}`,
      side: quote.side,
      price: quote.price,
      remainingQty: quote.qty,
    }));

  it("is free most of the time and never more than a rung a side", () => {
    for (const [market, anchor] of [
      [BTC, 78_000],
      [ETH, 2_500],
      [SOL, 203.45],
    ] as const) {
      const grid = gridSize(anchor, market, production);
      const build = (at: number) =>
        buildLadder({
          anchor: at,
          signedInventoryNotional: 0,
          market,
          config: production,
        });

      let resting = asResting(build(anchor));
      let free = 0;
      let touched = 0;
      const steps = 60;

      // A tenth of a cell at a time across three cells: most steps must not
      // move the ladder at all, and the ones that do must move it by one rung.
      for (let step = 1; step <= steps; step += 1) {
        const desired = build(anchor - (step * grid) / 20);
        const { toCancel, toPlace } = reconcileLadder({ desired, resting });

        expect(toCancel.length).toBeLessThanOrEqual(2);
        expect(toPlace.length).toBeLessThanOrEqual(2);
        if (!toCancel.length && !toPlace.length) free += 1;
        touched += toCancel.length + toPlace.length;

        const cancelled = new Set(toCancel.map((order) => order.id));
        resting = [
          ...resting.filter((order) => !cancelled.has(order.id)),
          ...toPlace.map((quote, index) => ({
            id: `sweep-${step}-${index}`,
            side: quote.side,
            price: quote.price,
            remainingQty: quote.qty,
          })),
        ];
      }

      /**
       * Three cells over sixty steps. The two sides cross their boundaries at
       * different moments — `bidRef` and `askRef` are a spread apart — so a
       * cell costs two steps of one rung each rather than one step of two,
       * which is six busy steps and twelve orders touched in all.
       *
       * The comparison that matters: the anchor-relative ladder this replaced
       * had NO free steps and touched all forty orders on every one of them,
       * so the same sweep cost 2400 `orders` rows.
       */
      expect(free).toBeGreaterThanOrEqual(steps - 8);
      expect(touched).toBeLessThanOrEqual(16);
    }
  });

  it("costs one rung a side when it crosses one, not the whole ladder", () => {
    for (const [market, anchor] of [
      [BTC, 78_000],
      [ETH, 2_500],
      [SOL, 203.45],
    ] as const) {
      const grid = gridSize(anchor, market, production);
      let resting = asResting(
        buildLadder({ anchor, signedInventoryNotional: 0, market, config: production }),
      );

      // Walk several cells, so this is the steady state and not a lucky first
      // step: each one should cost the same one-in, one-out on each side.
      for (let step = 1; step <= 4; step += 1) {
        const desired = buildLadder({
          anchor: anchor - step * grid,
          signedInventoryNotional: 0,
          market,
          config: production,
        });
        const { toCancel, toPlace } = reconcileLadder({ desired, resting });

        expect({ market: market.slug, step, cancels: toCancel.length, places: toPlace.length })
          .toEqual({ market: market.slug, step, cancels: 2, places: 2 });

        const cancelled = new Set(toCancel.map((order) => order.id));
        resting = [
          ...resting.filter((order) => !cancelled.has(order.id)),
          ...toPlace.map((quote, index) => ({
            id: `step-${step}-${index}`,
            side: quote.side,
            price: quote.price,
            remainingQty: quote.qty,
          })),
        ];

        // And the book that results is still the ladder, not a drifted copy.
        expect(reconcileLadder({ desired, resting })).toEqual({
          toCancel: [],
          toPlace: [],
        });
      }
    }
  });
});

describe("reconcileLadder", () => {
  const market = SOL;
  const ladder = (anchor: number, inventory = 0) =>
    buildLadder({
      anchor,
      signedInventoryNotional: inventory,
      market,
      config,
    });

  const asResting = (quotes: ReturnType<typeof buildLadder>) =>
    quotes.map((quote, index) => ({
      id: `order-${index}`,
      side: quote.side,
      price: quote.price,
      remainingQty: quote.qty,
    }));

  it("does nothing when the book already is the ladder", () => {
    const desired = ladder(102.65);
    const { toCancel, toPlace } = reconcileLadder({
      desired,
      resting: asResting(desired),
    });
    expect(toCancel).toHaveLength(0);
    expect(toPlace).toHaveLength(0);
  });

  it("places the whole ladder onto an empty book", () => {
    const desired = ladder(102.65);
    const { toCancel, toPlace } = reconcileLadder({
      desired,
      resting: [],
    });
    expect(toCancel).toHaveLength(0);
    expect(toPlace).toHaveLength(desired.length);
  });

  /**
   * The regression. Under rank matching this replaced one rung and left the
   * ladder walking one step out of position every time a level filled — which
   * is how two identical orders ended up on the same price in ETH.
   */
  it("refills only the filled rung when the inside level is consumed", () => {
    const desired = ladder(102.65);
    const resting = asResting(desired).filter(
      (order) => !(order.side === "LONG" && order.price === bids(desired)[0]!.price),
    );

    const { toCancel, toPlace } = reconcileLadder({
      desired,
      resting,
    });

    expect(toCancel).toHaveLength(0);
    expect(toPlace).toHaveLength(1);
    expect(toPlace[0]!.side).toBe("LONG");
    expect(toPlace[0]!.level).toBe(0);
    expect(toPlace[0]!.price).toBe(bids(desired)[0]!.price);
  });

  it("never places onto a price an adopted order already holds", () => {
    // Every reachable state, walked: the anchor drifting through a whole level
    // step is what put two orders on one price in the first place.
    let resting = asResting(ladder(102.65));
    for (let step = 0; step <= 40; step += 1) {
      const anchor = 102.65 + step * 0.01;
      const desired = ladder(anchor);
      const { toCancel, toPlace } = reconcileLadder({
        desired,
        resting,
      });

      const cancelled = new Set(toCancel.map((order) => order.id));
      const kept = resting.filter((order) => !cancelled.has(order.id));
      for (const quote of toPlace) {
        expect(
          kept.some(
            (order) => order.side === quote.side && order.price === quote.price,
          ),
        ).toBe(false);
      }

      resting = [
        ...kept,
        ...toPlace.map((quote, index) => ({
          id: `new-${step}-${index}`,
          side: quote.side,
          price: quote.price,
          remainingQty: quote.qty,
        })),
      ];

      // And the invariant that matters downstream: one order per price per side.
      for (const side of ["LONG", "SHORT"] as const) {
        const prices = resting
          .filter((order) => order.side === side)
          .map((order) => order.price);
        expect(new Set(prices).size).toBe(prices.length);
      }
    }
  });

  it("replaces a rung the taker half-consumed", () => {
    const desired = ladder(102.65);
    const resting = asResting(desired).map((order, index) =>
      index === 0 ? { ...order, remainingQty: order.remainingQty * 0.4 } : order,
    );

    const { toCancel, toPlace } = reconcileLadder({
      desired,
      resting,
    });

    expect(toCancel.map((order) => order.id)).toEqual(["order-0"]);
    expect(toPlace).toHaveLength(1);
  });

  it("cancels orders the ladder no longer has a rung for", () => {
    const desired = ladder(102.65);
    const resting = [
      ...asResting(desired),
      { id: "stray", side: "LONG" as const, price: 50, remainingQty: 1 },
    ];

    const { toCancel, toPlace } = reconcileLadder({
      desired,
      resting,
    });

    expect(toCancel.map((order) => order.id)).toEqual(["stray"]);
    expect(toPlace).toHaveLength(0);
  });

  it("leaves a rung alone while it drifts inside tolerance", () => {
    const desired = ladder(102.65);
    const resting = asResting(desired);
    const nudged = reconcileLadder({
      desired: ladder(102.6501),
      resting,
    });
    expect(nudged.toPlace).toHaveLength(0);
    expect(nudged.toCancel).toHaveLength(0);
  });
});
