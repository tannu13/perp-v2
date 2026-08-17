import { cn } from "@/lib/cn";

/**
 * THE SEAM — the system's signature primitive.
 *
 * A perpetual future is a market of opposing pressure held in balance: longs
 * against shorts, tethered to spot by funding. The most characteristic moment
 * in the whole product is the middle of the order book, where bids pressing up
 * meet asks pressing down and the last traded price sits exactly on the join.
 *
 * This component generalises that moment. Wherever two opposing quantities meet
 * — bids/asks, long/short open interest, margin used/free, 24h buy/sell volume
 * — they grow toward each other from opposite edges and meet at a seam that
 * carries the equilibrium value.
 *
 * It is information, not ornament: the meeting point IS the ratio, so the
 * balance is readable before any number is. Used consistently it becomes the
 * thing the interface is remembered by.
 */
export type SeamProps = {
  /** Left-side magnitude — the long / buy / used side. */
  left: number;
  /** Right-side magnitude — the short / sell / free side. */
  right: number;
  /** Sits on the join. Usually the equilibrium value: mid price, funding rate. */
  value?: React.ReactNode;
  leftLabel?: React.ReactNode;
  rightLabel?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /**
   * `directional` is the default buy/sell green-red. `neutral` uses interactive
   * blue against the muted surface for non-directional ratios like margin used
   * vs free, where green/red would falsely imply a trade side.
   */
  intent?: "directional" | "neutral";
  className?: string;
};

const heights = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-4",
} as const;

export function Seam({
  left,
  right,
  value,
  leftLabel,
  rightLabel,
  size = "md",
  intent = "directional",
  className,
}: SeamProps) {
  const total = left + right;
  // An empty market is a real state — split it evenly rather than dividing by zero.
  const leftPct = total > 0 ? (left / total) * 100 : 50;

  const leftFill = intent === "directional" ? "bg-buy" : "bg-interactive";
  const rightFill = intent === "directional" ? "bg-sell" : "bg-border-strong";

  // The value sits ON the join, not centred in the row — that is the whole idea.
  // Clamped so an extreme ratio parks it inside the track instead of colliding
  // with the edge labels or overflowing the container.
  const valueLeft = Math.min(Math.max(leftPct, 16), 84);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {(leftLabel || value || rightLabel) && (
        <div className="relative flex items-baseline justify-between gap-2 text-micro tnum">
          <span className="text-text-tertiary">{leftLabel}</span>
          {value && (
            <span
              className="absolute -translate-x-1/2 font-mono whitespace-nowrap text-text-primary transition-all duration-base ease-out-quart"
              style={{ left: `${valueLeft}%` }}
            >
              {value}
            </span>
          )}
          <span className="text-text-tertiary">{rightLabel}</span>
        </div>
      )}

      <div
        className={cn(
          "relative flex w-full overflow-hidden rounded-xs bg-surface-inset",
          heights[size],
        )}
        role="img"
        aria-label={`${Math.round(leftPct)}% versus ${Math.round(100 - leftPct)}%`}
      >
        <div
          className={cn("h-full transition-all duration-base ease-out-quart", leftFill)}
          style={{ width: `${leftPct}%` }}
        />
        <div className="h-full flex-1 transition-all duration-base ease-out-quart">
          <div className={cn("h-full w-full", rightFill)} />
        </div>

        {/* The join itself. A hairline of page ground, so the two sides read as
            pressing against each other rather than as one continuous bar. */}
        <div
          className="absolute inset-y-0 w-px bg-surface-base transition-all duration-base ease-out-quart"
          style={{ left: `${leftPct}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

/**
 * The vertical form, for the order book's own middle. Bids press up from below
 * and asks press down from above; the seam is the last traded price.
 */
export function SeamRule({
  value,
  delta,
  className,
}: {
  value: React.ReactNode;
  delta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex items-baseline gap-2 border-y border-border-subtle bg-surface-inset px-1.5 py-1",
        className,
      )}
    >
      <span className="text-num-lg tnum font-semibold text-text-primary">
        {value}
      </span>
      {delta && <span className="text-num-sm tnum">{delta}</span>}
    </div>
  );
}
