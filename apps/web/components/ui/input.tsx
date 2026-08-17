"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { inputBase, useFieldContext } from "./field";
import { SearchIcon } from "./icons";

export const inputVariants = cva(inputBase, {
  variants: {
    size: {
      sm: "h-(--size-control-sm) px-2.5 text-body-sm",
      md: "h-(--size-control-md) px-3 text-body-sm",
      lg: "h-(--size-control-lg) px-3.5 text-body-md",
    },
    /** Numeric entry uses tabular figures so digits stop shifting as you type. */
    numeric: {
      true: "text-num-md tnum",
    },
  },
  defaultVariants: { size: "md" },
});

export type InputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  // `size` is the legacy character-count attribute and `prefix` is the RDFa one;
  // both are typed as strings on HTMLInputElement, so they must be dropped
  // before being redefined as a variant and a ReactNode.
  "size" | "prefix"
> &
  VariantProps<typeof inputVariants> & {
    /** Trailing unit or currency marker, e.g. USD / SOL. */
    suffix?: React.ReactNode;
    /** Leading adornment. */
    prefix?: React.ReactNode;
  };

export function Input({
  className,
  size,
  numeric,
  suffix,
  prefix,
  id,
  ...props
}: InputProps) {
  const field = useFieldContext();
  const controlId = id ?? field?.controlId;

  const input = (
    <input
      id={controlId}
      aria-invalid={field?.invalid || undefined}
      aria-describedby={field?.describedBy}
      className={cn(
        inputVariants({ size, numeric }),
        prefix && "pl-9",
        suffix && "pr-14",
        className,
      )}
      {...props}
    />
  );

  if (!prefix && !suffix) return input;

  return (
    <div className="relative flex items-center">
      {prefix && (
        <span className="pointer-events-none absolute left-3 flex items-center text-text-tertiary [&_svg]:size-4">
          {prefix}
        </span>
      )}
      {input}
      {suffix && (
        <span className="pointer-events-none absolute right-3 font-mono text-micro uppercase text-text-tertiary">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function SearchInput({
  className,
  ...props
}: Omit<InputProps, "prefix">) {
  return (
    <Input
      type="search"
      prefix={<SearchIcon />}
      placeholder="Search markets"
      className={cn("[&::-webkit-search-cancel-button]:hidden", className)}
      {...props}
    />
  );
}

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, id, rows = 4, ...props }: TextareaProps) {
  const field = useFieldContext();
  return (
    <textarea
      id={id ?? field?.controlId}
      rows={rows}
      aria-invalid={field?.invalid || undefined}
      aria-describedby={field?.describedBy}
      className={cn(inputBase, "resize-y px-3 py-2 text-body-sm", className)}
      {...props}
    />
  );
}
