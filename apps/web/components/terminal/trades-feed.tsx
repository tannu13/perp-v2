"use client";

import { cn } from "@/lib/cn";
import { formatNumber, formatTime } from "@/lib/format";
import type { FeedState, Trade } from "@/lib/market-feed";
import type { Market } from "@/lib/markets";
import {
  EmptyState,
  ListIcon,
  ScrollArea,
  SkeletonRegion,
  SkeletonRows,
} from "@/components/ui";

/**
 * Recent prints. Direction is carried by an explicit ▲/▼ glyph as well as
 * colour, keeping the feed readable in greyscale.
 */
export function TradesFeed({
  trades,
  market,
  source,
  available = true,
  className,
}: {
  trades: Trade[];
  market: Market;
  /**
   * Needed to tell "no prints yet because the socket is still opening" from "no
   * prints because nothing has traded". An empty array alone cannot distinguish
   * them, and the old copy — "Waiting for prints." — quietly asserted the first
   * even on a market that had genuinely gone quiet.
   */
  source: FeedState["source"];
  /**
   * Whether the trades feed publishes at all.
   *
   * It does now — Phase 12 made the engine emit a print per fill and ws-server
   * relay it (G16). Before that, ws-server accepted a subscription to
   * `feed:{marketId}:trades` and nothing ever wrote to it, so an empty tape was
   * a permanent condition and "trades appear here the moment the book crosses"
   * was a promise the system could not keep. The prop stays because the two
   * empty states are different claims and only one of them can be true at a
   * time; it is passed `TRADES_PUBLISHED` rather than read here so the pane
   * tells the truth by itself if that ever goes back to false.
   */
  available?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center px-2 pb-1 text-micro uppercase text-text-tertiary">
        <span className="flex-1">Price</span>
        <span className="flex-1 text-right">Size ({market.base})</span>
        <span className="flex-1 text-right">Time</span>
      </div>

      {/* Overlay scrollbar: a native one appearing as prints stream in would
          narrow the content box and reflow every row beneath it. */}
      <ScrollArea className="min-h-0 flex-1">
        {trades.length === 0 && !available ? (
          <EmptyState
            size="sm"
            icon={ListIcon}
            title="No public trade tape"
            description="This exchange does not publish trades yet. Your own fills are in the Fills tab."
          />
        ) : trades.length === 0 && source === "connecting" ? (
          <SkeletonRegion label={`Loading ${market.slug} trades`}>
            <SkeletonRows rows={12} columns={3} className="px-2" />
          </SkeletonRegion>
        ) : trades.length === 0 ? (
          <EmptyState
            size="sm"
            icon={ListIcon}
            title="No prints yet"
            description="Trades appear here the moment the book crosses."
          />
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
      </ScrollArea>
    </div>
  );
}
