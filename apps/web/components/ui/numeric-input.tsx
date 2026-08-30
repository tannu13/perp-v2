"use client";

import { cn } from "@/lib/cn";
import { inputBase, useFieldContext } from "./field";
import { MinusIcon, PlusIcon } from "./icons";

export type NumericInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size" | "type" | "onChange" | "value"
> & {
  value: string;
  onValueChange: (next: string) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Unit shown inside the field — USD, SOL, %. */
  suffix?: string;
  /**
   * Refuses a decimal point entirely.
   *
   * For values whose storage is an integer — slippage is an `integer` column.
   * Rejecting the keystroke is the honest option: accepting "0.5" and rounding
   * it on the way to the wire changes a number the user typed and read back in
   * a confirmation dialog.
   */
  integerOnly?: boolean;
  /**
   * `lg` is for the order ticket specifically: 44px tall with 20px figures.
   * The whole screen is numbers, so the two fields where the user commits money
   * have to outweigh the surrounding readouts. Tables stay at `md`.
   */
  inputSize?: "md" | "lg";
};

/**
 * Price and quantity entry.
 *
 * Deliberately a text input, not `type="number"`. Number inputs silently
 * discard values the browser considers malformed, scroll-wheel-mutate on hover,
 * and vary in decimal handling across locales — all unacceptable when the value
 * is money. Digits are kept as strings end to end, matching the backend, which
 * also sends prices and sizes as strings to avoid float drift.
 */
export function NumericInput({
  className,
  value,
  onValueChange,
  step = 0.01,
  min,
  max,
  suffix,
  integerOnly = false,
  inputSize = "md",
  id,
  disabled,
  ...props
}: NumericInputProps) {
  const field = useFieldContext();
  const lg = inputSize === "lg";

  const clamp = (n: number) => {
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  };

  const nudge = (direction: 1 | -1) => {
    const current = Number.parseFloat(value);
    const base = Number.isFinite(current) ? current : 0;
    // Round to the step's precision so 0.1 + 0.2 never surfaces as 0.30000000000000004.
    const decimals = integerOnly ? 0 : (String(step).split(".")[1] ?? "").length;
    onValueChange(clamp(base + direction * step).toFixed(decimals));
  };

  const handleChange = (raw: string) => {
    // Allow empty, digits, one dot. Reject everything else rather than
    // silently coercing, so a typo never becomes a real order value.
    const allowed = integerOnly ? /^\d*$/ : /^\d*\.?\d*$/;
    if (raw === "" || allowed.test(raw)) onValueChange(raw);
  };

  return (
    <div className="relative flex items-center">
      <input
        id={id ?? field?.controlId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        disabled={disabled}
        aria-invalid={field?.invalid || undefined}
        aria-describedby={field?.describedBy}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            nudge(1);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            nudge(-1);
          }
        }}
        className={cn(
          inputBase,
          "tnum",
          lg
            ? "h-(--size-control-lg) pl-3.5 text-num-lg"
            : "h-(--size-control-md) pl-3 text-num-md",
          suffix ? "pr-24" : "pr-20",
          className,
        )}
        {...props}
      />

      <div className="pointer-events-none absolute right-2 flex items-center gap-1">
        {suffix && (
          <span className="mr-1 font-mono text-micro uppercase text-text-tertiary">
            {suffix}
          </span>
        )}
        <Stepper label="Decrease" onClick={() => nudge(-1)} disabled={disabled}>
          <MinusIcon className="size-3.5" />
        </Stepper>
        <Stepper label="Increase" onClick={() => nudge(1)} disabled={disabled}>
          <PlusIcon className="size-3.5" />
        </Stepper>
      </div>
    </div>
  );
}

function Stepper({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "pointer-events-auto flex size-5 items-center justify-center rounded-xs",
        "text-text-tertiary transition-colors duration-fast",
        "hover:bg-surface-hover hover:text-text-primary active:bg-surface-active",
        "disabled:pointer-events-none disabled:text-text-disabled",
      )}
    >
      {children}
    </button>
  );
}
