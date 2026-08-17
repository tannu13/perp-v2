"use client";

import { useEffect, useRef, useState } from "react";
import type { ColorToken } from "../_data/tokens";

/**
 * Converts a computed `rgb()` / `rgba()` string to hex, preserving alpha as a
 * percentage since several tokens are intentionally translucent.
 */
function toHex(rgb: string): string {
  const parts = rgb.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return rgb;

  const [r, g, b] = parts.slice(0, 3).map(Number);
  const alpha = parts.length > 3 ? Number(parts[3]) : 1;

  const hex =
    "#" +
    [r, g, b]
      .map((n) => Math.round(n).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();

  return alpha < 1 ? `${hex} · ${Math.round(alpha * 100)}%` : hex;
}

/**
 * One documentation row, shaped like an order-book depth row so the styleguide
 * is built out of the product's own vernacular.
 *
 * The chip paints itself with `var(--token)` and then reports its OWN computed
 * background. Nothing here is transcribed by hand, so the docs cannot go stale
 * when tokens.css changes.
 */
export function Swatch({ token }: { token: ColorToken }) {
  const chipRef = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!chipRef.current) return;
    const bg = getComputedStyle(chipRef.current).backgroundColor;
    setResolved(toHex(bg));
  }, []);

  return (
    <div className="relative flex items-center gap-3 border-b border-border-subtle px-3 py-1.5 last:border-b-0">
      {/* depth-bar fill, borrowed from the order book */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 opacity-10"
        style={{
          width: `${token.fill}%`,
          background: `var(--${token.varName})`,
        }}
      />

      <div
        ref={chipRef}
        className="relative h-5 w-8 shrink-0 rounded-sm border border-white/10"
        style={{ background: `var(--${token.varName})` }}
      />

      <div className="relative min-w-0 flex-1">
        <div className="truncate font-mono text-num-sm text-text-primary">
          --{token.varName}
        </div>
        <div className="truncate text-micro text-text-disabled">
          {token.usage}
        </div>
      </div>

      <div className="relative shrink-0 text-right font-mono text-micro tnum">
        <div className="text-text-tertiary">{resolved ?? " "}</div>
        <div className="text-text-disabled">{token.resolves}</div>
      </div>
    </div>
  );
}

/** A Layer 1 ramp, rendered directly from the primitive variables. */
export function Ramp({ prefix, steps }: { prefix: string; steps: string[] }) {
  return (
    <div>
      <div className="flex overflow-hidden rounded-md border border-border-default">
        {steps.map((step) => (
          <div
            key={step}
            className="h-11 flex-1"
            style={{ background: `var(--${prefix}-${step})` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex">
        {steps.map((step) => (
          <div
            key={step}
            className="flex-1 text-center font-mono text-[10px] text-text-disabled tnum"
          >
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}
