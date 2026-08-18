"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon, MinusIcon } from "./icons";

/**
 * Checkbox and Radio both keep a real, focusable native input underneath and
 * paint a sibling box. `peer` drives every visual state from the input's own
 * pseudo-classes, so keyboard focus, disabled and checked stay in sync with the
 * platform rather than with React state.
 */
const controlBox = [
  "pointer-events-none absolute left-0 top-0 flex items-center justify-center",
  "border transition-colors duration-fast ease-out-quart",
  // Raised like every other input — a recessed box disappeared on dark panels.
  "border-border-strong bg-surface-input text-transparent",
  "peer-hover:border-border-focus/60",
  "peer-checked:border-interactive peer-checked:bg-interactive peer-checked:text-white",
  "peer-focus-visible:border-border-focus peer-focus-visible:shadow-focus",
  "peer-disabled:border-border-subtle peer-disabled:bg-surface-disabled peer-disabled:text-text-disabled",
  "peer-aria-[invalid=true]:border-border-error",
];

export type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "size"
> & {
  label?: React.ReactNode;
  /** Partial selection — renders a dash rather than a tick. */
  indeterminate?: boolean;
};

export function Checkbox({
  className,
  label,
  indeterminate,
  id,
  disabled,
  ...props
}: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <div className={cn("flex items-start gap-2", className)}>
      <span className="relative flex size-4 shrink-0 items-center">
        <input
          id={inputId}
          type="checkbox"
          disabled={disabled}
          // Indeterminate is a DOM property with no HTML attribute, so it has to
          // be set on the node. A ref callback beats useEffect here — it runs on
          // mount and on every re-render without an extra pass.
          ref={(node) => {
            if (node) node.indeterminate = Boolean(indeterminate);
          }}
          className="peer size-4 cursor-pointer appearance-none disabled:cursor-not-allowed"
          {...props}
        />
        <span className={cn(controlBox, "size-4 rounded-sm")}>
          {indeterminate ? (
            <MinusIcon className="size-3" />
          ) : (
            <CheckIcon className="size-3" />
          )}
        </span>
      </span>

      {label && (
        <label
          htmlFor={inputId}
          className={cn(
            "cursor-pointer text-body-sm leading-tight select-none",
            disabled ? "text-text-disabled" : "text-text-secondary",
          )}
        >
          {label}
        </label>
      )}
    </div>
  );
}

export type RadioProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "size"
> & {
  label?: React.ReactNode;
};

export function Radio({ className, label, id, disabled, ...props }: RadioProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <div className={cn("flex items-start gap-2", className)}>
      <span className="relative flex size-4 shrink-0 items-center">
        <input
          id={inputId}
          type="radio"
          disabled={disabled}
          className="peer size-4 cursor-pointer appearance-none disabled:cursor-not-allowed"
          {...props}
        />
        <span className={cn(controlBox, "size-4 rounded-full")}>
          <span className="size-1.5 rounded-full bg-current" />
        </span>
      </span>

      {label && (
        <label
          htmlFor={inputId}
          className={cn(
            "cursor-pointer text-body-sm leading-tight select-none",
            disabled ? "text-text-disabled" : "text-text-secondary",
          )}
        >
          {label}
        </label>
      )}
    </div>
  );
}
