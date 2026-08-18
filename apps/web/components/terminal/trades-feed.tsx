"use client";

import { cn } from "@/lib/cn";
import { formatNumber, formatTime } from "@/lib/format";
import type { Trade } from "@/lib/market-feed";
import type { Market } from "@/lib/markets";

/**
 * Recent prints. Direction is carried by an explicit ▲/▼ glyph as well as
 * colour, keeping the feed readable in greyscale.
 */
export function TradesFeed({
  trades,
  market,
  className,
}: {
  trades: Trade[];
  market: Market;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center px-2 pb-1 text-micro uppercase text-text-tertiary">
        <span className="flex-1">Price</span>
        <span className="flex-1 text-right">Size ({market.base})</span>
        <span className="flex-1 text-right">Time</span>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {trades.length === 0 ? (
          <p className="px-2 py-6 text-center text-caption text-text-tertiary">
            Waiting for prints.
          </p>
        ) : (
          trades.map((t) => (
            <div
              key={t.id}
              className="flex h-(--size-row) items-center px-2 text-num-md tnum"
            >
              {/* 400 here, 500 on the neutral columns — see OrderBook. */}
              <span
                className={cn(
                  "flex flex-1 items-center gap-1 font-normal",
                  t.side === "buy" ? "text-buy-text" : "text-sell-text",
                )}
              >
                <span aria-hidden className="text-[9px]">
                  {t.side === "buy" ? "▲" : "▼"}
                </span>
                <span className="sr-only">
                  {t.side === "buy" ? "Buy" : "Sell"}
                </span>
                {formatNumber(t.price, market.priceDecimals)}
              </span>
              <span className="flex-1 text-right text-text-secondary">
                {formatNumber(t.qty, market.sizeDecimals)}
              </span>
              <span className="flex-1 text-right text-text-tertiary">
                {formatTime(t.ts)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
