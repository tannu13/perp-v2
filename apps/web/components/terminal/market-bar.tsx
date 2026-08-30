"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCountdown, formatNumber } from "@/lib/format";
import { MARKETS, type Market } from "@/lib/markets";
import type { MarketFeedValue } from "@/lib/market-feed";
import { Badge, StatusDot, Tooltip } from "@/components/ui";

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

const NO_24H_SOURCE =
  "No source for this yet — the exchange publishes no 24h statistics.";

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

/**
 * The connection vocabulary.
 *
 * Four states and a fifth condition, all of which have to be distinguishable
 * because they license different readings of the numbers beside them. `live` is
 * the only one under which the ladder is current; the other three all mean
 * "what you are looking at is the last thing the server said, and here is why
 * it stopped". `stale` is the awkward one: the socket claims to be open and
 * nothing is coming through it. The price poller broadcasts depth at ~1 Hz per
 * market, so five seconds of silence is a fault, not a quiet market (§7.5).
 *
 * There is deliberately no state that means "these numbers are invented". That
 * state used to exist, was called `simulated`, and is what Phase 11 removed.
 */
function connection(feed: MarketFeedValue) {
  if (feed.source === "live" && feed.stale) {
    return {
      word: "stale",
      intent: "warning" as const,
      pulse: false,
      hint: "The feed is connected but has sent nothing for over five seconds. The book on screen is the last update received.",
    };
  }
  switch (feed.source) {
    case "live":
      return {
        word: "live",
        intent: "online" as const,
        pulse: true,
        hint: "Connected. The book and last price are the exchange's own, updating as they change.",
      };
    case "connecting":
      return {
        word: "connecting",
        intent: "info" as const,
        pulse: true,
        hint: "Opening the market data feed.",
      };
    case "reconnecting":
      return {
        word: "reconnecting",
        intent: "warning" as const,
        pulse: true,
        hint: "The feed dropped and is being reopened. Everything on screen is frozen at the last update — nothing here is estimated.",
      };
    case "disconnected":
      return {
        word: "disconnected",
        intent: "offline" as const,
        pulse: false,
        hint: "The feed is closed. Everything on screen is frozen at the last update — nothing here is estimated.",
      };
  }
}

export function MarketBar({
  market,
  feed,
  className,
}: {
  market: Market;
  feed: MarketFeedValue;
  className?: string;
}) {
  const funding = useFundingCountdown();
  const { lastPrice, prevPrice, markPrice } = feed;
  const status = connection(feed);

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

      {/*
        Four figures with no source — and Phase 12 left them that way.

        They were the simulator's own running high, low, volume and change, over
        a random walk that started when the page loaded. Nothing in the system
        publishes them: there is no stats endpoint and no 24h aggregate over
        `fills`, and inventing one from the tape the client happens to have seen
        since it connected would be the same lie with a shorter window. G17 is
        answered by an em dash rather than closed; the endpoint that would close
        it is still PROPOSED (D6).
      */}
      <Stat label="24h change" hint={NO_24H_SOURCE}>
        —
      </Stat>
      <Stat label="24h high" hint={NO_24H_SOURCE}>
        —
      </Stat>
      <Stat label="24h low" hint={NO_24H_SOURCE}>
        —
      </Stat>
      <Stat label={`24h volume (${market.quote})`} hint={NO_24H_SOURCE}>
        —
      </Stat>
      {/*
        Labelled "Index price", not "Mark price".

        The number is `orderbook.indexPrice`: the Binance spot price the poller
        delivers, which the engine writes on every tick and evaluates every
        liquidation against. Calling it the mark would put a second, different
        "Mark" on the same screen — the Positions tab marks each row against the
        mid of this exchange's own book, which is the right basis for a PnL and
        the wrong one for a liquidation. Two numbers, two jobs, two labels.

        Still an em dash before the first frame lands: null means "no frame
        yet", which is not a price.
      */}
      <Stat
        label="Index price"
        hint="The spot index this exchange tracks, from Binance. Liquidations are evaluated against it — not against the last trade, and not against the mid of this book, which is what the Positions tab marks against."
      >
        {markPrice === null
          ? "—"
          : formatNumber(markPrice, market.priceDecimals)}
      </Stat>
      <Stat label="Funding in" hint="Funding is applied hourly to open positions.">
        {formatCountdown(funding)}
      </Stat>

      <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
        <Tooltip content={status.hint}>
          <div className="flex items-center gap-1.5">
            <StatusDot
              intent={status.intent}
              pulse={status.pulse}
              label={status.hint}
            />
            <span className="text-micro whitespace-nowrap text-text-tertiary">
              {status.word}
            </span>
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
