"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useMarketFeed } from "@/lib/market-feed";
import { useHasMounted, useIsDesktop } from "@/lib/use-media-query";
import type { Market } from "@/lib/markets";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  ScrollArea,
  SegmentedControl,
} from "@/components/ui";
import { SiteHeader } from "@/components/chrome/site-header";
import { AccountTabs } from "./account-tabs";
import { MarketBar } from "./market-bar";
import { OrderBook } from "./order-book";
import { OrderForm } from "./order-form";
import { PriceChart } from "./price-chart";
import { TradesFeed } from "./trades-feed";

/**
 * Shared panel treatment — elevation e1.
 *
 * Every pane was previously sitting on the base canvas at e0 with only a
 * hairline between them, which is why the terminal read as one flat sheet. The
 * design system defines five elevation tiers; the terminal was using one.
 *
 * On dark, shadow is nearly invisible, so lightness carries the elevation and
 * the border only sharpens the edge — see the elevation tokens.
 */
const PANEL = "rounded-lg border border-border-subtle bg-surface-raised";

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
  // Both branches below stay unrendered until hydration completes, so the
  // server and first client tree are identical. See useHasMounted.
  const mounted = useHasMounted();

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
    /*
      Desktop is a FIXED viewport shell: exactly `h-dvh`, nothing overflows the
      window, and every scroll happens inside a panel.

      It was `min-h-dvh`, which let the panel row push the document taller than
      the window. With chart `min-h-340` + tabs `min-h-220` + market bar + gaps
      the content floor was ~622px, so any viewport shorter than that grew a
      page scrollbar — and because the gutter was not reserved, its appearing
      and disappearing reflowed the whole terminal. That was the flicker.

      Mobile stays `min-h-dvh`: page scrolling is the correct behaviour there,
      and the panes are tab-switched so only one is tall at a time.
    */
    <div
      className={cn(
        "flex flex-col bg-surface-base",
        "min-h-dvh lg:h-dvh lg:min-h-0 lg:overflow-hidden",
      )}
    >
      {/*
        The header is full-bleed chrome and a fixed 56px row; the panel region
        below takes the remainder. It sits INSIDE the h-dvh column rather than
        above it so the "header plus panels equals the window, exactly"
        invariant stays readable in one file — this is the layout that grew a
        page scrollbar the last time a fixed-height element was added without
        the flex row being told to give up space for it.
      */}
      <SiteHeader />

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          // One padding value and one gap for the whole shell, so the market
          // bar, the panel row and the window edges all share the same rhythm.
          // 8px rather than 6: once every section became a raised panel, 6 read
          // as cramped, and the extra 2px costs well under one order-book row.
          "gap-2 p-2",
        )}
      >
      <MarketBar market={market} feed={feed} className={PANEL} />

      {/* Pane switcher — mobile only; at lg the panes are all visible at once. */}
      <div className="lg:hidden">
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

      {/*
        Panels are raised surfaces on a base canvas, separated by an 8px seam of
        that canvas showing through — not cards floating in a margin.

        Elevation does the figure/ground work at zero pixel cost; the seam only
        has to be wide enough to read. 8px across three vertical boundaries and
        two horizontal costs ~40px total, under half an order-book row. A
        card-style 16-24px gutter would cost two full depth levels and swap
        terminal grammar for dashboard grammar.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        {/* chart + account panel */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div
            className={cn(
              PANEL,
              // min-h only on mobile, where the page scrolls anyway. On desktop
              // the chart takes whatever the flex row leaves it — a hard floor
              // here is what pushed short laptops into a page scrollbar.
              "min-h-[340px] flex-1 p-2 lg:min-h-0",
              mobilePane === "chart" ? "block" : "hidden",
              "lg:block",
            )}
          >
            <PriceChart market={market} />
          </div>

          {/* overflow-hidden so the tablist's bottom border is clipped by the
              panel's rounded corners instead of poking past them. */}
          <AccountTabs
            market={market}
            className={cn(
              PANEL,
              "overflow-hidden",
              // 34% of a short viewport is still usable; a 220px floor was not.
              "max-h-[46vh] lg:h-[34%] lg:max-h-none lg:min-h-[132px] lg:shrink-0",
            )}
          />
        </div>

        {/* book / trades rail */}
        <div
          className={cn(
            PANEL,
            "flex shrink-0 flex-col overflow-hidden",
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

          <ScrollArea className="min-h-0 flex-1" viewportClassName="p-2">
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
              <TradesFeed
                trades={feed.trades}
                market={market}
                source={feed.source}
              />
            </div>
          </ScrollArea>
        </div>

        {/* order ticket — docked rail on desktop only */}
        {mounted && isDesktop && (
          <ScrollArea
            className={cn(
              PANEL,
              "shrink-0",
              "w-(--size-order-form) xl:w-(--size-order-form-xl)",
            )}
            viewportClassName="p-3"
          >
            {ticket}
          </ScrollArea>
        )}
      </div>

      {/* mobile: docked CTA + sheet */}
      {mounted && !isDesktop && (
        <>
          <div className="sticky bottom-0 z-30 border-t border-border-subtle bg-surface-raised p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {/* `primary`, not `buy` — this opens the ticket, it does not buy
                anything. Green here would pre-suggest a side before the user
                has picked one. */}
            <Button
              intent="primary"
              size="lg"
              fullWidth
              onClick={() => setTicketOpen(true)}
            >
              Trade {market.slug}
            </Button>
          </div>

          <Dialog open={ticketOpen} onOpenChange={setTicketOpen}>
            <DialogContent className="max-h-[88dvh] overflow-y-auto">
              <DialogTitle>Trade {market.slug}</DialogTitle>
              {ticket}
            </DialogContent>
          </Dialog>
        </>
      )}
      </div>
    </div>
  );
}
