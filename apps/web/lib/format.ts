/**
 * Display formatting for money and sizes.
 *
 * The backend sends prices, quantities and margins as STRINGS (varchar(80) in
 * the drizzle schema) specifically to avoid float drift. These helpers accept
 * strings, format for display, and never round-trip a value back into storage.
 * Anything sent back to the API must be the original string, not a formatted one.
 */

const groupers = new Map<number, Intl.NumberFormat>();

function grouper(decimals: number) {
  let f = groupers.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    groupers.set(decimals, f);
  }
  return f;
}

/** Fixed-decimal, thousands-grouped. For prices and totals in tables. */
export function formatNumber(
  value: number | string,
  decimals = 2,
  { group = true }: { group?: boolean } = {},
): string {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) return "—";
  return group ? grouper(decimals).format(n) : n.toFixed(decimals);
}

/** Compact notation for volume figures: 18485368.61 → 18.49M */
export function formatCompact(value: number | string, decimals = 2): string {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(decimals)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(decimals)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

export function formatUsd(value: number | string, decimals = 2): string {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  return `${sign}$${grouper(decimals).format(Math.abs(n))}`;
}

/** Percentage with an explicit sign — direction must survive without colour. */
export function formatSignedPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

/** HH:MM:SS in local time — the trades feed and fill history both use it. */
export function formatTime(ts: number | string | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

/** Countdown as MM:SS or HH:MM:SS, for the funding interval. */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining < 0) msRemaining = 0;
  const total = Math.floor(msRemaining / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Shortens an order id or hash for display without losing both ends. */
export function truncateId(id: string, head = 6, tail = 4): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
