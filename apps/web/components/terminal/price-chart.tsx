"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { cn } from "@/lib/cn";
import {
  fetchCandles,
  syntheticCandles,
  INTERVALS,
  type Candle,
  type Interval,
} from "@/lib/candles";
import type { Market } from "@/lib/markets";
import { SegmentedControl } from "@/components/ui";

/**
 * Candles + volume.
 *
 * The chart is themed from our own tokens rather than lightweight-charts'
 * defaults: values are read off the document at mount with getComputedStyle, so
 * a token edit propagates here too and the chart never holds its own palette.
 */
function token(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

export function PriceChart({
  market,
  className,
}: {
  market: Market;
  className?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const [interval, setInterval] = useState<Interval>("1h");
  const [source, setSource] = useState<"binance" | "offline" | "loading">(
    "loading",
  );

  // Create the chart once; data and theme are applied separately.
  useEffect(() => {
    if (!holder.current) return;

    const chart = createChart(holder.current, {
      layout: {
        background: { color: "transparent" },
        textColor: token("--color-text-tertiary", "#7c848f"),
        fontFamily: token("--font-sans", "sans-serif"),
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: token("--color-border-subtle", "#1c1f24") },
        horzLines: { color: token("--color-border-subtle", "#1c1f24") },
      },
      rightPriceScale: {
        borderColor: token("--color-border-subtle", "#1c1f24"),
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: token("--color-border-subtle", "#1c1f24"),
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: token("--color-border-strong", "#3a3f47"),
          labelBackgroundColor: token("--color-surface-modal", "#1c1f24"),
        },
        horzLine: {
          color: token("--color-border-strong", "#3a3f47"),
          labelBackgroundColor: token("--color-surface-modal", "#1c1f24"),
        },
      },
      autoSize: true,
    });

    const buy = token("--color-long-500", "#00c278");
    const sell = token("--color-short-500", "#f0616d");

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: buy,
      downColor: sell,
      borderUpColor: buy,
      borderDownColor: sell,
      wickUpColor: buy,
      wickDownColor: sell,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart
      .priceScale("vol")
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  // Load data whenever the market or interval changes.
  useEffect(() => {
    let cancelled = false;
    setSource("loading");

    const apply = (data: Candle[], kind: "binance" | "offline") => {
      if (cancelled || !candleRef.current || !volumeRef.current) return;
      candleRef.current.setData(data as never);
      volumeRef.current.setData(
        data.map((c) => ({
          time: c.time as never,
          value: c.volume,
          color:
            c.close >= c.open
              ? token("--color-buy-muted-strong", "rgba(0,194,120,0.24)")
              : token("--color-sell-muted-strong", "rgba(240,97,109,0.24)"),
        })) as never,
      );
      chartRef.current?.timeScale().fitContent();
      setSource(kind);
    };

    fetchCandles(market.binanceSymbol, interval)
      .then((data) => apply(data, "binance"))
      // Offline or blocked: fall back rather than showing an empty chart.
      .catch(() => apply(syntheticCandles(seedFor(market.slug)), "offline"));

    return () => {
      cancelled = true;
    };
  }, [market, interval]);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <SegmentedControl
          aria-label="Chart interval"
          size="sm"
          options={INTERVALS.map((i) => ({ value: i, label: i }))}
          value={interval}
          onValueChange={(v) => setInterval(v as Interval)}
        />
        <span className="font-mono text-micro text-text-disabled">
          {source === "binance"
            ? "index · binance"
            : source === "offline"
              ? "offline sample"
              : "loading…"}
        </span>
      </div>
      <div ref={holder} className="min-h-0 flex-1" />
    </div>
  );
}

function seedFor(slug: string) {
  if (slug.startsWith("BTC")) return 68450;
  if (slug.startsWith("ETH")) return 3285;
  return 205;
}
