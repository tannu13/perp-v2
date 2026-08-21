"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { Depth, DepthLevel } from "@/lib/market-feed";
import type { Market } from "@/lib/markets";
import {
  Delta,
  EmptyState,
  LayersIcon,
  Seam,
  SkeletonRegion,
  SkeletonRows,
} from "@/components/ui";

/**
 * The depth ladder — the product's most characteristic surface.
 *
 * Two non-chromatic cues carry direction here, because hue alone excludes the
 * ~8% of men with deuteranopia:
 *   1. Ask bars fill from the RIGHT, bid bars fill from the LEFT. Orientation
 *      is readable in greyscale.
 *   2. Bids sit below the seam and asks above it, which is the conventional
 *      spatial encoding.
 * The seam itself is the last traded price, sitting exactly where the two sides
 * meet — the canonical instance of the system's signature primitive.
 */

type Row = { price: number; qty: number; total: number };

function accumulate(levels: DepthLevel[], limit: number): Row[] {
  const rows: Row[] = [];
  let running = 0;
  for (const [p, q] of levels.slice(0, limit)) {
    const price = Number.parseFloat(p);
    const qty = Number.parseFloat(q);
    if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;
    running += qty;
    rows.push({ price, qty, total: running });
  }
  return rows;
}

function LevelRow({
  row,
  max,
  side,
  market,
  onClick,
}: {
  row: Row;
  max: number;
  side: "bid" | "ask";
  market: Market;
  onClick: (price: number) => void;
}) {
  // Two bars on ONE shared scale — the cumulative maximum.
  //
  //   depthPct  cumulative liquidity at this price and everything better than
  //             it. This is what makes the ladder step monotonically.
  //   levelPct  this price level's own resting size — its contribution to the
  //             cumulative bar sitting behind it.
  //
  // Because total is a running sum, size <= total at every level, so the bright
  // bar always nests inside the dark one. No clamping required.
  const depthPct = max > 0 ? (row.total / max) * 100 : 0;
  const levelPct = max > 0 ? (row.qty / max) * 100 : 0;

  const isAsk = side === "ask";

  return (
    <button
      type="button"
      onClick={() => onClick(row.price)}
      title={`Set price to ${row.price} · ${row.qty} at this level, ${row.total} cumulative`}
      className={cn(
        "relative flex h-(--size-row) w-full items-center px-2 text-num-md tnum",
        "transition-colors duration-instant hover:bg-surface-hover",
        "focus-visible:outline-none focus-visible:shadow-focus",
      )}
    >
      {/* Cumulative depth — the dark, longer bar.
          Orientation is the greyscale-safe direction cue: asks grow leftward
          from the right edge, bids grow rightward from the left. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-px",
          isAsk ? "right-0 bg-sell-depth-total" : "left-0 bg-buy-depth-total",
        )}
        style={{ width: `${depthPct}%` }}
      />
      {/* This level alone — brighter, drawn on top, anchored to the same edge so
          it reads as the leading segment of the bar behind it. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-px",
          isAsk ? "right-0 bg-sell-depth-level" : "left-0 bg-buy-depth-level",
        )}
        style={{ width: `${levelPct}%` }}
      />
      {/* Price drops to 400 while the neutral columns stay at 500. Colour is
          already carrying this cell, so weight on top of it made the ladder
          read heavier than it needed to. */}
      <span
        className={cn(
          "relative flex-1 text-left font-normal",
          side === "ask" ? "text-sell-text" : "text-buy-text",
        )}
      >
        {formatNumber(row.price, market.priceDecimals)}
      </span>
      <span className="relative flex-1 text-right text-text-secondary">
        {formatNumber(row.qty, market.sizeDecimals)}
      </span>
      <span className="relative hidden flex-1 text-right text-text-tertiary sm:block">
        {formatNumber(row.total, market.sizeDecimals)}
      </span>
    </button>
  );
}

export function OrderBook({
  depth,
  lastPrice,
  prevPrice,
  change,
  market,
  onPriceSelect,
  rows = 11,
  className,
}: {
  depth: Depth | null;
  lastPrice: number | null;
  prevPrice: number | null;
  change: number | null;
  market: Market;
  onPriceSelect: (price: number) => void;
  rows?: number;
  className?: string;
}) {
  const { bids, asks, max, bidVol, askVol } = useMemo(() => {
    const b = accumulate(depth?.bids ?? [], rows);
    const a = accumulate(depth?.asks ?? [], rows);
    return {
      bids: b,
      asks: a,
      max: Math.max(b.at(-1)?.total ?? 0, a.at(-1)?.total ?? 0),
      bidVol: b.at(-1)?.total ?? 0,
      askVol: a.at(-1)?.total ?? 0,
    };
  }, [depth, rows]);

  // Direction of the last tick, used only to tint the seam price.
  const tick =
    lastPrice === null || prevPrice === null
      ? "flat"
      : lastPrice > prevPrice
        ? "up"
        : lastPrice < prevPrice
          ? "down"
          : "flat";

  /**
   * Three distinct states, and conflating any two of them tells a lie.
   *
   *   depth === null      no snapshot has arrived — the socket is still opening.
   *                       A shimmering ladder is the truth here.
   *   depth, no levels    the book really is empty. A permanent shimmer would
   *                       claim data is still coming when nothing is.
   *   levels              the ladder.
   *
   * The skeleton renders the same row count at the same `--size-row`, above and
   * below the seam, so the seam does not jump when the first snapshot lands.
   */
  const connecting = depth === null;
  const empty = !connecting && bids.length === 0 && asks.length === 0;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center px-2 pb-1 text-micro uppercase text-text-tertiary">
        <span className="flex-1">Price</span>
        <span className="flex-1 text-right">Size ({market.base})</span>
        <span className="hidden flex-1 text-right sm:block">Total</span>
      </div>

      {/* Asks render worst-price-first so the best ask sits against the seam. */}
      <div className="flex flex-col-reverse justify-end overflow-hidden">
        {connecting && (
          <SkeletonRegion label={`Loading ${market.slug} order book`}>
            <SkeletonRows rows={rows} columns={3} className="px-2" />
          </SkeletonRegion>
        )}
        {asks.map((row) => (
          <LevelRow
            key={`a-${row.price}`}
            row={row}
            max={max}
            side="ask"
            market={market}
            onClick={onPriceSelect}
          />
        ))}
      </div>

      {/* THE SEAM — where the two sides meet. */}
      <div className="my-1 flex items-baseline gap-2 border-y border-border-subtle bg-surface-inset px-2 py-1.5">
        <span
          className={cn(
            "text-num-lg tnum font-semibold",
            tick === "up"
              ? "text-buy-text"
              : tick === "down"
                ? "text-sell-text"
                : "text-text-primary",
          )}
        >
          {lastPrice === null
            ? "—"
            : formatNumber(lastPrice, market.priceDecimals)}
        </span>
        {change !== null && <Delta value={change} percent size="sm" />}
      </div>

      <div className="flex flex-col overflow-hidden">
        {connecting && (
          // Unlabelled: SkeletonRegion above already announced the book once,
          // and two live regions for one ladder would read it out twice.
          <SkeletonRows rows={rows} columns={3} className="px-2" />
        )}
        {empty && (
          <EmptyState
            size="sm"
            icon={LayersIcon}
            title="No resting orders"
            description="Nothing is quoted on either side of this market yet."
          />
        )}
        {bids.map((row) => (
          <LevelRow
            key={`b-${row.price}`}
            row={row}
            max={max}
            side="bid"
            market={market}
            onClick={onPriceSelect}
          />
        ))}
      </div>

      {/* Book balance, using the same primitive at a different scale. */}
      <div className="mt-auto px-2 pt-2">
        <Seam
          left={bidVol}
          right={askVol}
          size="sm"
          leftLabel={`${Math.round((bidVol / (bidVol + askVol || 1)) * 100)}%`}
          rightLabel={`${Math.round((askVol / (bidVol + askVol || 1)) * 100)}%`}
        />
      </div>
    </div>
  );
}
