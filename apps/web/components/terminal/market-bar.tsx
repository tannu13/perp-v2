"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCompact, formatCountdown, formatNumber } from "@/lib/format";
import { MARKETS, type Market } from "@/lib/markets";
import type { FeedState } from "@/lib/market-feed";
import { Badge, Delta, StatusDot, Tooltip } from "@/components/ui";

function Stat({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const body = (
    <div className="flex flex-col gap-0.5">
      <span className="text-micro whitespace-nowrap uppercase text-text-tertiary">
        {label}
      </span>
      <span className="text-num-sm tnum whitespace-nowrap text-text-primary">
        {children}
      </span>
    </div>
  );
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}

/** Funding settles hourly; this counts down to the top of the next hour. */
function useFundingCountdown() {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(now.getHours() + 1, 0, 0, 0);
      setMs(next.getTime() - now.getTime());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return ms;
}

export function MarketBar({
  market,
  feed,
  className,
}: {
  market: Market;
  feed: FeedState;
  className?: string;
}) {
  const funding = useFundingCountdown();
  const { lastPrice, prevPrice, markPrice, stats } = feed;

  const tick =
    lastPrice === null || prevPrice === null
      ? "flat"
      : lastPrice > prevPrice
        ? "up"
        : lastPrice < prevPrice
          ? "down"
          : "flat";

  return (
    <div
      // Surface and border now come from the caller's PANEL treatment: the bar
      // is a panel like every other section, not full-bleed chrome. Full-bleed
      // stopped working once the page reserved a scrollbar gutter — the bar ran
      // under it while every panel below stopped short, so its right edge
      // looked misaligned.
      className={cn(
        "scrollbar-thin flex shrink-0 items-center gap-5 overflow-x-auto px-3 py-2.5",
        className,
      )}
    >
      {/* Market selector — a native select until GET /markets exists. */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-surface-modal text-micro font-semibold text-text-secondary">
            {market.base.slice(0, 2)}
          </span>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-body-md font-semibold text-text-primary">
                {market.slug}
              </span>
              <Badge intent="outline" size="sm">
                {market.maxLeverage}x
              </Badge>
            </div>
            <div className="flex gap-1.5">
              {MARKETS.filter((m) => m.id !== market.id).map((m) => (
                <Link
                  key={m.id}
                  href={`/trade/${m.slug}`}
                  className="text-[10px] text-text-disabled transition-colors duration-fast hover:text-text-link"
                >
                  {m.slug}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "shrink-0 text-num-xl tnum font-semibold",
          tick === "up"
            ? "text-buy-text"
            : tick === "down"
              ? "text-sell-text"
              : "text-text-primary",
        )}
      >
        {lastPrice === null ? "—" : formatNumber(lastPrice, market.priceDecimals)}
      </div>

      <Stat label="24h change">
        {stats ? <Delta value={stats.change} percent size="sm" /> : "—"}
      </Stat>
      <Stat label="24h high">
        {stats ? formatNumber(stats.high, market.priceDecimals) : "—"}
      </Stat>
      <Stat label="24h low">
        {stats ? formatNumber(stats.low, market.priceDecimals) : "—"}
      </Stat>
      <Stat label={`24h volume (${market.quote})`}>
        {stats ? formatCompact(stats.volume) : "—"}
      </Stat>
      <Stat
        label="Mark price"
        hint="Index price from the Binance spot feed. Liquidations are evaluated against this, not the last trade."
      >
        {markPrice === null
          ? "—"
          : formatNumber(markPrice, market.priceDecimals)}
      </Stat>
      <Stat label="Funding in" hint="Funding is applied hourly to open positions.">
        {formatCountdown(funding)}
      </Stat>

      <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
        <div className="flex items-center gap-1.5">
          <StatusDot
            intent={feed.source === "live" ? "online" : feed.source === "simulated" ? "warning" : "offline"}
            pulse={feed.source === "live"}
            label={
              feed.source === "live"
                ? "Live feed connected"
                : feed.source === "simulated"
                  ? "Simulated feed — backend not connected"
                  : "Connecting"
            }
          />
          <span className="text-micro whitespace-nowrap text-text-tertiary">
            {feed.source === "live"
              ? "live"
              : feed.source === "simulated"
                ? "simulated"
                : "connecting"}
          </span>
        </div>
      </div>
    </div>
  );
}
