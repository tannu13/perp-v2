"use client";

import { useEffect, useRef, useState } from "react";
import type { Market } from "./markets";

/**
 * Market data feed.
 *
 * Types mirror the backend exactly: `MarketDepthSchema` in @repo/shared sends
 * bids and asks as [price, qty] STRING tuples, and the ws-server publishes
 * `{ feed, marketId, data }` on `feed:{marketId}:{feed}` channels for
 * last-traded-price, mark-price, depth and trades.
 *
 * Because the backend stack (Postgres, Redis, engine, ws-server) is not
 * necessarily running during frontend work, this hook attempts the real socket
 * first and falls back to a local simulator. `source` is surfaced in the UI so
 * a simulated book is never mistaken for a live one.
 */

export type DepthLevel = [price: string, qty: string];

export type Depth = {
  market: string;
  lastUpdateId: number;
  timestamp: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
};

export type Trade = {
  id: string;
  price: string;
  qty: string;
  side: "buy" | "sell";
  ts: number;
};

export type FeedState = {
  depth: Depth | null;
  trades: Trade[];
  lastPrice: number | null;
  prevPrice: number | null;
  markPrice: number | null;
  stats: { high: number; low: number; volume: number; change: number } | null;
  source: "live" | "simulated" | "connecting";
};

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3010";
const FEEDS = "last-traded-price,mark-price,depth,trades";
const MAX_TRADES = 40;

/**
 * Offline seed, used only until the live spot price arrives. These are
 * deliberately rough — the simulator re-anchors to Binance on first tick so the
 * book and the chart do not show two different markets.
 */
function seedPrice(slug: string) {
  if (slug.startsWith("BTC")) return 68000;
  if (slug.startsWith("ETH")) return 3200;
  return 180;
}

/** Anchors the simulator to the same index the chart plots. */
async function fetchSpot(binanceSymbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const px = Number.parseFloat(json.price);
    return Number.isFinite(px) ? px : null;
  } catch {
    return null;
  }
}

function buildBook(mid: number, market: Market, depth = 14): Depth {
  const bids: DepthLevel[] = [];
  const asks: DepthLevel[] = [];
  const tick = market.tickSize;

  for (let i = 0; i < depth; i++) {
    const bidPx = mid - tick * (i + 1);
    const askPx = mid + tick * (i + 1);
    // Liquidity thins with distance, with enough noise to look alive.
    const shape = (1 / (i * 0.35 + 1)) * (0.6 + Math.random() * 0.9);
    bids.push([
      bidPx.toFixed(market.priceDecimals),
      (shape * 260).toFixed(market.sizeDecimals),
    ]);
    asks.push([
      askPx.toFixed(market.priceDecimals),
      (shape * 240).toFixed(market.sizeDecimals),
    ]);
  }

  return {
    market: market.slug,
    lastUpdateId: Date.now(),
    timestamp: Date.now(),
    bids,
    asks,
  };
}

export function useMarketFeed(market: Market): FeedState {
  const [state, setState] = useState<FeedState>({
    depth: null,
    trades: [],
    lastPrice: null,
    prevPrice: null,
    markPrice: null,
    stats: null,
    source: "connecting",
  });

  // Kept in a ref so the simulator interval never re-subscribes on each tick.
  const priceRef = useRef(seedPrice(market.slug));
  const openRef = useRef(seedPrice(market.slug));

  useEffect(() => {
    priceRef.current = seedPrice(market.slug);
    openRef.current = seedPrice(market.slug);

    let socket: WebSocket | null = null;
    let simTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    // Guards against a double start — onerror and onclose can both fire, and
    // the check must happen before the await below, not after.
    let starting = false;

    const startSimulator = async () => {
      if (cancelled || simTimer || starting) return;
      starting = true;

      // Anchor BEFORE emitting anything. Re-anchoring after the first tick
      // leaked a placeholder price into the UI, which the order ticket then
      // latched onto as its limit price.
      const spot = await fetchSpot(market.binanceSymbol);
      if (cancelled) return;
      if (spot !== null) {
        priceRef.current = spot;
        openRef.current = spot;
      }

      let high: number | null = null;
      let low: number | null = null;
      let volume = 0;

      const tick = () => {
        // Random walk with mild mean reversion so it does not drift away.
        const drift = (openRef.current - priceRef.current) * 0.002;
        const shock = (Math.random() - 0.5) * market.tickSize * 6;
        priceRef.current = Math.max(
          market.tickSize,
          priceRef.current + drift + shock,
        );

        const px = priceRef.current;
        const hi = high === null ? px : Math.max(high, px);
        const lo = low === null ? px : Math.min(low, px);
        high = hi;
        low = lo;

        const qty = Math.random() * 12 + 0.4;
        volume += qty * px;

        const trade: Trade = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          price: px.toFixed(market.priceDecimals),
          qty: qty.toFixed(market.sizeDecimals),
          side: Math.random() > 0.5 ? "buy" : "sell",
          ts: Date.now(),
        };

        setState((prev) => ({
          depth: buildBook(px, market),
          trades: [trade, ...prev.trades].slice(0, MAX_TRADES),
          lastPrice: px,
          prevPrice: prev.lastPrice,
          markPrice: px * (1 + (Math.random() - 0.5) * 0.0004),
          stats: {
            high: hi,
            low: lo,
            volume,
            change: ((px - openRef.current) / openRef.current) * 100,
          },
          source: "simulated",
        }));
      };

      tick();
      simTimer = setInterval(tick, 900);
    };

    try {
      socket = new WebSocket(
        `${WS_URL}?feeds=${FEEDS}&market_id=${encodeURIComponent(market.id)}`,
      );

      // If the socket has not opened shortly, assume the stack is down and
      // fall back rather than leaving the terminal blank.
      const failover = setTimeout(() => {
        if (socket && socket.readyState !== WebSocket.OPEN) void startSimulator();
      }, 1200);

      socket.onopen = () => clearTimeout(failover);
      socket.onerror = () => void startSimulator();
      socket.onclose = () => void startSimulator();

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "system") return;

          setState((prev) => {
            switch (msg.feed) {
              case "depth":
                return { ...prev, depth: msg.data as Depth, source: "live" };
              case "last-traded-price": {
                const px = Number.parseFloat(msg.data.price);
                return {
                  ...prev,
                  prevPrice: prev.lastPrice,
                  lastPrice: px,
                  source: "live",
                };
              }
              case "mark-price":
                return {
                  ...prev,
                  markPrice: Number.parseFloat(msg.data.price),
                  source: "live",
                };
              case "trades":
                return {
                  ...prev,
                  trades: [msg.data as Trade, ...prev.trades].slice(0, MAX_TRADES),
                  source: "live",
                };
              default:
                return prev;
            }
          });
        } catch {
          /* a malformed frame must not tear down the feed */
        }
      };
    } catch {
      void startSimulator();
    }

    return () => {
      cancelled = true;
      if (simTimer) clearInterval(simTimer);
      socket?.close();
    };
  }, [market]);

  return state;
}
