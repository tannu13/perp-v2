"use client";

import { createContext, useContext, useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Wires label / hint / error to a control without every input re-implementing
 * the id plumbing. The context is what lets Input, Select, Textarea and
 * NumericInput all share one accessibility contract:
 *   - the label's `htmlFor` matches the control
 *   - `aria-describedby` points at the hint AND the error when both exist
 *   - `aria-invalid` flips from a single source of truth
 */
type FieldContextValue = {
  controlId: string;
  hintId: string;
  errorId: string;
  invalid: boolean;
  describedBy: string | undefined;
};

const FieldContext = createContext<FieldContextValue | null>(null);

/** Returns null outside a Field, so controls stay usable standalone. */
export function useFieldContext() {
  return useContext(FieldContext);
}

export type FieldProps = {
  label?: string;
  hint?: string;
  error?: string;
  /** Renders a subtle marker and sets `required` semantics on the label. */
  required?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const controlId = `${id}-control`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);

  // Error is announced after the hint, so screen readers get context then fault.
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <FieldContext.Provider
      value={{ controlId, hintId, errorId, invalid, describedBy }}
    >
      <div className={cn("flex flex-col gap-1.5", className)}>
        {label && (
          <label
            htmlFor={controlId}
            className="flex items-center gap-1 text-caption font-medium text-text-secondary"
          >
            {label}
            {required && (
              <span className="text-sell-text" aria-hidden>
                *
              </span>
            )}
          </label>
        )}

        {children}

        {/* Error replaces the hint rather than stacking — two lines of guidance
            under one field is noise, and the error is the actionable one. */}
        {error ? (
          <p
            id={errorId}
            role="alert"
            className="text-caption text-sell-text"
          >
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-caption text-text-tertiary">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Shared input chrome, so every text-entry control looks identical. */
export const inputBase = [
  // Raised, not recessed — see the surface-input token note.
  "w-full rounded-md border bg-surface-input text-text-primary",
  "placeholder:text-text-disabled",
  "transition-colors duration-fast ease-out-quart",
  "border-border-default",
  "hover:border-border-strong hover:bg-surface-input-hover",
  "focus-visible:outline-none focus-visible:border-border-focus focus-visible:shadow-focus",
  "forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2",
  "disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-disabled disabled:text-text-disabled",
  "aria-[invalid=true]:border-border-error",
  "aria-[invalid=true]:focus-visible:border-border-error aria-[invalid=true]:focus-visible:shadow-focus-error",
];
