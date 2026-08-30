/**
 * Candle source.
 *
 * The backend has no OHLC endpoint — apps/backend serves order, position, fill
 * and depth routes only, and nothing aggregates the `fills` table into klines.
 * Until it does, history comes from Binance's public REST, which is defensible
 * here because apps/price-poller already uses Binance as the spot index.
 *
 * The trade-off is explicit: the chart shows the INDEX market, not this
 * exchange's own book. Swap `fetchCandles` for the real endpoint when it exists
 * and nothing downstream changes.
 */

export type Candle = {
  /** Seconds — the unit lightweight-charts expects. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export async function fetchCandles(
  binanceSymbol: string,
  interval: Interval = "1h",
  limit = 300,
): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Klines request failed: ${res.status}`);

  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) throw new Error("Unexpected klines payload");

  return raw.map((k: any) => ({
    time: Math.floor(k[0] / 1000),
    open: Number.parseFloat(k[1]),
    high: Number.parseFloat(k[2]),
    low: Number.parseFloat(k[3]),
    close: Number.parseFloat(k[4]),
    volume: Number.parseFloat(k[5]),
  }));
}

/*
 * `syntheticCandles` was here.
 *
 * It generated 240 hourly candles from a seeded random walk — its own linear
 * congruential generator, which is why Phase 11's `Math.random` grep across
 * `apps/web/lib` came back empty while an invented price series was still being
 * drawn on the terminal. The chart fell back to it whenever the klines request
 * failed, labelled "offline sample", and a labelled invention is still an
 * invention: a candlestick series is read as history, and the label is four
 * words in the corner of it.
 *
 * Deleted in Phase 12. A failed klines request now says so — see `PriceChart`.
 */
