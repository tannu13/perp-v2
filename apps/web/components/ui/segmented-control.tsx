"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

export type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /**
   * `directional` colors the selected segment by position — first green, second
   * red — for the Buy/Sell switch. `neutral` is for everything else
   * (Limit/Market, book grouping, timeframes).
   */
  intent?: "neutral" | "directional";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  className?: string;
  "aria-label": string;
};

const sizes = {
  sm: "h-(--size-control-sm) text-body-sm",
  md: "h-(--size-control-md) text-body-sm",
  lg: "h-(--size-control-lg) text-body-md",
} as const;

/**
 * Roving-tabindex radiogroup: the control is one tab stop, and arrows move
 * between segments. That is the platform behaviour for a set of mutually
 * exclusive options, and it keeps the order form from becoming a long tab walk.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  intent = "neutral",
  size = "md",
  fullWidth,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onValueChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-inset p-1",
        fullWidth && "flex w-full",
        className,
      )}
    >
      {options.map((option, i) => {
        const selected = option.value === value;

        const selectedTone =
          intent === "directional"
            ? i === 0
              ? "bg-buy-muted-strong text-buy-text"
              : "bg-sell-muted-strong text-sell-text"
            : "bg-surface-modal text-text-primary";

        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[i] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "flex flex-1 items-center justify-center rounded-sm px-3 font-medium",
              "transition-colors duration-fast ease-out-quart",
              "focus-visible:outline-none focus-visible:shadow-focus",
              "forced-colors:focus-visible:outline-2",
              sizes[size],
              selected
                ? selectedTone
                : "text-text-tertiary hover:bg-surface-hover hover:text-text-secondary",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
