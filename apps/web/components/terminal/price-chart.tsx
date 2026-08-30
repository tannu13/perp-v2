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
  INTERVALS,
  type Candle,
  type Interval,
} from "@/lib/candles";
import type { Market } from "@/lib/markets";
import {
  ErrorState,
  SegmentedControl,
  Skeleton,
  SkeletonRegion,
} from "@/components/ui";

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
  /**
   * `unavailable` replaced `offline`, which used to mean "showing you invented
   * candles". There is no third state where the chart draws something: either
   * Binance answered or the pane says it did not.
   */
  const [source, setSource] = useState<"binance" | "unavailable" | "loading">(
    "loading",
  );
  const [reloads, setReloads] = useState(0);

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

    const apply = (data: Candle[]) => {
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
      setSource("binance");
    };

    fetchCandles(market.binanceSymbol, interval)
      .then(apply)
      .catch(() => {
        // Was a fallback to a generated price series. Nothing here can draw a
        // candle the source did not send; if the request failed, the pane says
        // so and offers to try again.
        if (cancelled) return;
        candleRef.current?.setData([]);
        volumeRef.current?.setData([]);
        setSource("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [market, interval, reloads]);

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
        {/*
          The chart plots the INDEX market, not this exchange's own book: there
          is no OHLC endpoint here and nothing aggregates `fills` into klines,
          so the series is Binance's. Saying which market a price series belongs
          to is not optional when the two can differ by a factor of fifty, as
          they do on a book the E2E suite has been trading at four dollars.
        */}
        <span className="font-mono text-micro text-text-disabled">
          {source === "binance"
            ? "index · binance"
            : source === "unavailable"
              ? "unavailable"
              : "loading…"}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* The chart library owns this node, so the skeleton overlays it rather
            than replacing it — swapping the element out would tear down the
            chart instance on every interval change. */}
        <div ref={holder} className="h-full" />
        {source === "loading" && <ChartSkeleton />}
        {source === "unavailable" && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-base">
            <ErrorState
              size="sm"
              title="No candles to show"
              description="The index candles come from Binance's public API and it did not answer. Nothing else here has price history to draw."
              onRetry={() => setReloads((n) => n + 1)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Candle-shaped placeholder.
 *
 * A plain grey rectangle would read as a broken chart. Bars of varying height
 * say "a price series is coming" — which is the only thing a skeleton is for.
 * Heights are a fixed sequence, not random: random would differ between the
 * server and client renders and trip a hydration mismatch.
 */
const CANDLE_HEIGHTS = [
  38, 52, 46, 61, 55, 70, 64, 58, 72, 66, 79, 71, 63, 75, 68, 82, 74, 60, 55,
  67, 59, 71, 64, 78,
];

function ChartSkeleton() {
  return (
    <SkeletonRegion
      label="Loading price chart"
      className="absolute inset-0 flex items-end gap-1 px-2 pb-6"
    >
      {CANDLE_HEIGHTS.map((h, i) => (
        <Skeleton
          key={i}
          shape="text"
          className="min-w-1 flex-1"
          style={{ height: `${h}%` }}
        />
      ))}
    </SkeletonRegion>
  );
}
