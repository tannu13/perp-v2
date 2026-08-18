"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useMarketFeed } from "@/lib/market-feed";
import { useIsDesktop } from "@/lib/use-media-query";
import type { Market } from "@/lib/markets";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  SegmentedControl,
} from "@/components/ui";
import { AccountTabs } from "./account-tabs";
import { MarketBar } from "./market-bar";
import { OrderBook } from "./order-book";
import { OrderForm } from "./order-form";
import { PriceChart } from "./price-chart";
import { TradesFeed } from "./trades-feed";

/**
 * The terminal shell.
 *
 * ONE component tree, rearranged by CSS. An earlier version branched into two
 * mutually exclusive trees (`lg:hidden` beside `hidden lg:flex`) which mounted
 * BOTH — two chart instances, two kline fetches, two of every subscription.
 * Panes are therefore hidden with CSS and mounted once.
 *
 * The order ticket is the one genuine exception: on mobile it belongs in a
 * bottom sheet and on desktop in a docked rail, and rendering it in both places
 * would fork its form state. That single placement decision uses a media query.
 *
 * Layouts:
 *   base  (<1024) one column; chart / book / trades tab-switched, ticket in a sheet
 *   lg    (≥1024) chart + book side by side, ticket docked right
 *   xl    (≥1440) same with wider rails
 */
export function Terminal({ market }: { market: Market }) {
  const feed = useMarketFeed(market);
  const isDesktop = useIsDesktop();

  const [price, setPrice] = useState("");
  const [bookTab, setBookTab] = useState<"book" | "trades">("book");
  const [mobilePane, setMobilePane] = useState<"chart" | "book" | "trades">(
    "chart",
  );
  const [ticketOpen, setTicketOpen] = useState(false);

  // Seed the limit price from the first tick so the ticket is usable without
  // typing a price. The feed anchors to spot before emitting, so this is real.
  useEffect(() => {
    if (!price && feed.lastPrice !== null) {
      setPrice(feed.lastPrice.toFixed(market.priceDecimals));
    }
  }, [feed.lastPrice, price, market.priceDecimals]);

  const ticket = (
    <OrderForm
      market={market}
      lastPrice={feed.lastPrice}
      price={price}
      onPriceChange={setPrice}
    />
  );

  return (
    <div className="flex min-h-dvh flex-col bg-surface-base">
      <MarketBar market={market} feed={feed} />

      {/* Pane switcher — mobile only; at lg the panes are all visible at once. */}
      <div className="border-b border-border-subtle p-2 lg:hidden">
        <SegmentedControl
          aria-label="Panel"
          size="sm"
          fullWidth
          options={[
            { value: "chart", label: "Chart" },
            { value: "book", label: "Book" },
            { value: "trades", label: "Trades" },
          ]}
          value={mobilePane}
          onValueChange={setMobilePane}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* chart + account panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className={cn(
              "min-h-[340px] flex-1 p-2 lg:border-b lg:border-border-subtle",
              mobilePane === "chart" ? "block" : "hidden",
              "lg:block",
            )}
          >
            <PriceChart market={market} />
          </div>

          <AccountTabs
            market={market}
            className={cn(
              "border-t border-border-subtle lg:border-t-0",
              "max-h-[46vh] lg:h-[38%] lg:max-h-none lg:min-h-[220px] lg:shrink-0",
            )}
          />
        </div>

        {/* book / trades rail */}
        <div
          className={cn(
            "flex shrink-0 flex-col lg:border-l lg:border-border-subtle",
            "lg:w-(--size-orderbook) xl:w-(--size-orderbook-xl)",
            mobilePane === "chart" ? "hidden" : "flex",
            "lg:flex",
          )}
        >
          {/* On mobile the pane switcher above already chose book vs trades. */}
          <div className="hidden border-b border-border-subtle p-2 lg:block">
            <SegmentedControl
              aria-label="Book or trades"
              size="sm"
              fullWidth
              options={[
                { value: "book", label: "Book" },
                { value: "trades", label: "Trades" },
              ]}
              value={bookTab}
              onValueChange={setBookTab}
            />
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
            <div
              className={cn(
                mobilePane === "book" ? "block" : "hidden",
                bookTab === "book" ? "lg:block" : "lg:hidden",
              )}
            >
              <OrderBook
                depth={feed.depth}
                lastPrice={feed.lastPrice}
                prevPrice={feed.prevPrice}
                change={feed.stats?.change ?? null}
                market={market}
                onPriceSelect={(p) => setPrice(p.toFixed(market.priceDecimals))}
              />
            </div>
            <div
              className={cn(
                "h-full",
                mobilePane === "trades" ? "block" : "hidden",
                bookTab === "trades" ? "lg:block" : "lg:hidden",
              )}
            >
              <TradesFeed trades={feed.trades} market={market} />
            </div>
          </div>
        </div>

        {/* order ticket — docked rail on desktop only */}
        {isDesktop && (
          <div
            className={cn(
              "scrollbar-thin shrink-0 overflow-y-auto border-l border-border-subtle p-3",
              "w-(--size-order-form) xl:w-(--size-order-form-xl)",
            )}
          >
            {ticket}
          </div>
        )}
      </div>

      {/* mobile: docked CTA + sheet */}
      {!isDesktop && (
        <>
          <div className="sticky bottom-0 z-30 border-t border-border-subtle bg-surface-raised p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <Button
              intent="buy"
              size="lg"
              fullWidth
              onClick={() => setTicketOpen(true)}
            >
              Trade {market.slug}
            </Button>
          </div>

          <Dialog open={ticketOpen} onOpenChange={setTicketOpen}>
            <DialogContent className="scrollbar-thin max-h-[88dvh] overflow-y-auto">
              <DialogTitle>Trade {market.slug}</DialogTitle>
              {ticket}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
