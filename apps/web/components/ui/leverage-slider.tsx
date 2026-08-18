"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Leverage selector.
 *
 * The previous version was a bare `input[type=range]` with `accent-color` and a
 * `bg-surface-inset` track — on a dark panel that track was invisible, so only
 * the thumb showed and the control read as a floating dot.
 *
 * This paints the groove, the filled portion and the stops explicitly from
 * tokens, keeping a real range input underneath for keyboard and screen-reader
 * behaviour. Stops are labelled because leverage is the single riskiest control
 * in the product and "4×" should never be a guess.
 */
export function LeverageSlider({
  value,
  onChange,
  max,
  stops,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  max: number;
  /** Marked positions. Defaults to a sensible spread up to max. */
  stops?: number[];
  className?: string;
}) {
  const id = useId();
  const marks = stops ?? defaultStops(max);
  const pct = ((value - 1) / (max - 1)) * 100;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-caption font-medium text-text-secondary">
          Leverage
        </label>
        <span
          className={cn(
            "font-mono text-num-md tnum font-semibold",
            // Higher leverage is a risk signal, so the readout carries it.
            value >= max * 0.8
              ? "text-health-critical"
              : value >= max * 0.5
                ? "text-health-caution"
                : "text-text-primary",
          )}
        >
          {value}×
        </span>
      </div>

      <div className="relative flex h-5 items-center">
        {/* groove */}
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-surface-inset ring-1 ring-border-default ring-inset" />
        {/* filled portion */}
        <div
          className="absolute h-1.5 rounded-full bg-interactive transition-[width] duration-fast ease-out-quart"
          style={{ width: `${pct}%` }}
        />
        {/* stops */}
        {marks.map((m) => {
          const at = ((m - 1) / (max - 1)) * 100;
          return (
            <span
              key={m}
              aria-hidden
              className={cn(
                "absolute size-1.5 -translate-x-1/2 rounded-full",
                m <= value ? "bg-interactive-hover" : "bg-border-strong",
              )}
              style={{ left: `${at}%` }}
            />
          );
        })}

        <input
          id={id}
          type="range"
          min={1}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-valuetext={`${value} times leverage`}
          className={cn(
            "relative w-full cursor-pointer appearance-none bg-transparent",
            "focus-visible:outline-none",
            // Thumb, styled per engine — there is no cross-browser shorthand.
            "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
            "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-interactive",
            "[&::-webkit-slider-thumb]:shadow-e1",
            "focus-visible:[&::-webkit-slider-thumb]:shadow-focus",
            "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-interactive",
            "[&::-moz-range-thumb]:bg-white",
            "[&::-moz-range-track]:bg-transparent",
          )}
        />
      </div>

      <div className="relative h-3">
        {marks.map((m) => (
          <button
            key={m}
            type="button"
            tabIndex={-1}
            onClick={() => onChange(m)}
            style={{ left: `${((m - 1) / (max - 1)) * 100}%` }}
            className="absolute -translate-x-1/2 font-mono text-[10px] text-text-disabled transition-colors duration-fast hover:text-text-secondary"
          >
            {m}×
          </button>
        ))}
      </div>
    </div>
  );
}

function defaultStops(max: number): number[] {
  if (max <= 10) return [1, 2, 5, 10].filter((n) => n <= max);
  if (max <= 20) return [1, 5, 10, 15, 20].filter((n) => n <= max);
  return [1, 10, 25, 50, max];
}
