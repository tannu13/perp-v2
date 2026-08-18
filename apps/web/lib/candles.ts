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

/**
 * Deterministic offline candles, used when the network is unavailable so the
 * terminal still renders something honest rather than an empty chart.
 */
export function syntheticCandles(seed: number, count = 240): Candle[] {
  const out: Candle[] = [];
  let price = seed;
  const now = Math.floor(Date.now() / 1000);
  let rng = 42;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648;
  };

  for (let i = count; i > 0; i--) {
    const open = price;
    const move = (rand() - 0.5) * seed * 0.012;
    const close = Math.max(seed * 0.5, open + move);
    const high = Math.max(open, close) * (1 + rand() * 0.004);
    const low = Math.min(open, close) * (1 - rand() * 0.004);
    out.push({
      time: now - i * 3600,
      open,
      high,
      low,
      close,
      volume: rand() * 900 + 100,
    });
    price = close;
  }
  return out;
}
