"use client";

import { cn } from "@/lib/cn";
import { inputBase, useFieldContext } from "./field";
import { ChevronDownIcon } from "./icons";

export type SelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "size"
> & {
  size?: "sm" | "md" | "lg";
};

const sizes = {
  sm: "h-(--size-control-sm) pl-2.5 text-body-sm",
  md: "h-(--size-control-md) pl-3 text-body-sm",
  lg: "h-(--size-control-lg) pl-3.5 text-body-md",
} as const;

/**
 * Native `<select>` on purpose. A custom listbox would need focus trapping,
 * type-ahead and virtualisation to match what the platform already does, and on
 * mobile the native picker is strictly better than anything hand-rolled.
 */
export function Select({
  className,
  size = "md",
  id,
  children,
  ...props
}: SelectProps) {
  const field = useFieldContext();

  return (
    <div className="relative flex items-center">
      <select
        id={id ?? field?.controlId}
        aria-invalid={field?.invalid || undefined}
        aria-describedby={field?.describedBy}
        className={cn(
          inputBase,
          sizes[size],
          "cursor-pointer appearance-none pr-9",
          // The native dropdown list is OS-rendered, so options need an explicit
          // background — otherwise they inherit the page's transparent ground.
          "[&>option]:bg-surface-overlay [&>option]:text-text-primary",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-3 size-4 text-text-tertiary" />
    </div>
  );
}
