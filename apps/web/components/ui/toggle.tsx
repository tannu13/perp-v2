"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

export type ToggleProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "size"
> & {
  label?: React.ReactNode;
  size?: "sm" | "md";
};

const track = {
  sm: "h-4 w-7",
  md: "h-5 w-9",
} as const;

const knob = {
  sm: "size-3 peer-checked:translate-x-3",
  md: "size-4 peer-checked:translate-x-4",
} as const;

/**
 * A switch, not a checkbox: it applies immediately rather than on form submit.
 * Still a native `input[type=checkbox]` underneath so it keeps real keyboard
 * and form semantics; `role="switch"` corrects how it is announced.
 */
export function Toggle({
  className,
  label,
  size = "md",
  id,
  disabled,
  ...props
}: ToggleProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className={cn("relative inline-flex shrink-0", track[size])}>
        <input
          id={inputId}
          type="checkbox"
          role="switch"
          disabled={disabled}
          className="peer size-full cursor-pointer appearance-none disabled:cursor-not-allowed"
          {...props}
        />
        <span
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full border",
            "border-border-strong bg-surface-input",
            "transition-colors duration-fast ease-out-quart",
            "peer-hover:border-border-focus/60",
            "peer-checked:border-interactive peer-checked:bg-interactive",
            "peer-focus-visible:shadow-focus",
            "peer-disabled:border-border-subtle peer-disabled:bg-surface-disabled",
          )}
        />
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 left-0.5 -translate-y-1/2 rounded-full",
            "bg-text-tertiary",
            "transition-transform duration-fast ease-spring",
            "peer-checked:bg-white",
            "peer-disabled:bg-text-disabled",
            knob[size],
          )}
        />
      </span>

      {label && (
        <label
          htmlFor={inputId}
          className={cn(
            "cursor-pointer text-body-sm select-none",
            disabled ? "text-text-disabled" : "text-text-secondary",
          )}
        >
          {label}
        </label>
      )}
    </div>
  );
}
