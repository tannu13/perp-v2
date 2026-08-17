import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Directional numbers — PnL, 24h change, funding.
 *
 * This is the component that answers the accessibility caveat raised in Phase 1:
 * roughly 8% of men cannot separate the buy green from the sell red, so color
 * alone must never carry direction. `Delta` therefore ALWAYS renders an explicit
 * sign, and the sign is not optional by design. Colour is reinforcement here,
 * never the signal.
 */
export const deltaVariants = cva("tnum tabular-nums whitespace-nowrap", {
  variants: {
    direction: {
      up: "text-buy-text",
      down: "text-sell-text",
      flat: "text-text-secondary",
    },
    size: {
      sm: "text-num-sm",
      md: "text-num-md",
      lg: "text-num-lg",
      xl: "text-num-xl",
    },
    weight: {
      normal: "font-medium",
      bold: "font-semibold",
    },
  },
  defaultVariants: { direction: "flat", size: "md", weight: "normal" },
});

export type DeltaProps = Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  "children"
> &
  Omit<VariantProps<typeof deltaVariants>, "direction"> & {
    value: number;
    /** Decimal places. Prices usually 2, sizes often more. */
    precision?: number;
    /** Renders as a percentage with a trailing %. */
    percent?: boolean;
    /** Currency or unit marker appended after the number. */
    unit?: string;
  };

export function Delta({
  className,
  value,
  precision = 2,
  percent,
  unit,
  size,
  weight,
  ...props
}: DeltaProps) {
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const magnitude = Math.abs(value).toFixed(precision);

  return (
    <span
      className={cn(deltaVariants({ direction, size, weight }), className)}
      {...props}
    >
      {sign}
      {magnitude}
      {percent ? "%" : ""}
      {unit ? ` ${unit}` : ""}
    </span>
  );
}

export const sideVariants = cva(
  "inline-flex items-center gap-1 rounded-sm px-1.5 font-mono text-micro font-medium uppercase",
  {
    variants: {
      side: {
        LONG: "bg-buy-muted text-buy-text",
        SHORT: "bg-sell-muted text-sell-text",
      },
      size: {
        sm: "h-4 text-[10px]",
        md: "h-5 text-micro",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export type SideProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof sideVariants> & {
    side: "LONG" | "SHORT";
  };

/**
 * Position direction as a word, not just a colour. Pairs with Delta to keep
 * every directional surface readable without hue.
 */
export function Side({ className, side, size, ...props }: SideProps) {
  return (
    <span className={cn(sideVariants({ side, size }), className)} {...props}>
      {side}
    </span>
  );
}

/**
 * A plain price with tabular figures and no directional colour — for the many
 * numbers that are values rather than changes.
 */
export function Num({
  className,
  value,
  precision = 2,
  size = "md",
  ...props
}: Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> & {
  value: number | string;
  precision?: number;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const text =
    typeof value === "number" ? value.toFixed(precision) : value;

  const sizeClass = {
    sm: "text-num-sm",
    md: "text-num-md",
    lg: "text-num-lg",
    xl: "text-num-xl",
  }[size];

  return (
    <span
      className={cn("tnum whitespace-nowrap text-text-primary", sizeClass, className)}
      {...props}
    >
      {text}
    </span>
  );
}
