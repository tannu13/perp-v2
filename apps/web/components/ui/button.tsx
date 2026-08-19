import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { SpinnerIcon } from "./icons";

/**
 * Every interactive atom shares this focus treatment. Declared once so the ring
 * cannot drift between controls.
 *
 * `outline-none` cancels the global :focus-visible outline from globals.css in
 * favour of the token ring; the forced-colors fallback restores a real outline
 * for Windows High Contrast, where box-shadow is not rendered at all.
 */
export const focusRing = [
  "focus-visible:outline-none focus-visible:shadow-focus",
  "forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2",
];

export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md font-semibold select-none",
    "transition-colors duration-fast ease-out-quart",
    ...focusRing,
    "disabled:pointer-events-none disabled:cursor-not-allowed",
  ],
  {
    variants: {
      intent: {
        /** Non-directional confirm. Blue, never green — see the token docs. */
        primary: [
          "bg-interactive text-white",
          "hover:bg-interactive-hover active:bg-interactive-active",
          "disabled:bg-interactive-disabled disabled:text-text-disabled",
        ],
        buy: [
          "bg-buy text-text-inverse",
          "hover:bg-buy-hover active:bg-buy-active",
          "disabled:bg-surface-disabled disabled:text-text-disabled",
        ],
        sell: [
          "bg-sell text-text-inverse",
          "hover:bg-sell-hover active:bg-sell-active",
          "disabled:bg-surface-disabled disabled:text-text-disabled",
        ],
        neutral: [
          "border border-border-strong bg-surface-raised text-text-primary",
          "hover:bg-surface-hover active:bg-surface-active",
          "disabled:border-border-subtle disabled:bg-surface-disabled disabled:text-text-disabled",
        ],
        ghost: [
          "bg-transparent text-text-secondary",
          "hover:bg-surface-hover hover:text-text-primary active:bg-surface-active",
          "disabled:text-text-disabled",
        ],
        /** Solid. For a committed destructive action — the confirm inside a dialog. */
        danger: [
          "bg-danger text-white",
          "hover:bg-danger-400 active:bg-danger-600",
          "disabled:bg-surface-disabled disabled:text-text-disabled",
        ],
        /**
         * Quiet destructive, for row actions.
         *
         * A table of twenty solid-red buttons is alarm fatigue, and cancelling a
         * resting order is routine — no money moves. This stays neutral at rest
         * and only turns red on hover/focus, so the consequence is signalled at
         * the moment of intent rather than shouted continuously.
         * Matches IconButton's `danger`, which was already this weight.
         */
        "danger-ghost": [
          "bg-transparent text-text-tertiary",
          "hover:bg-danger-muted hover:text-danger-400",
          "active:bg-danger-muted active:text-danger",
          "focus-visible:text-danger-400",
          "disabled:text-text-disabled",
        ],
      },
      size: {
        sm: "h-(--size-control-sm) px-2.5 text-body-sm",
        md: "h-(--size-control-md) px-4 text-body-sm",
        lg: "h-(--size-control-lg) px-5 text-body-md",
      },
      fullWidth: {
        true: "w-full",
      },
    },
    defaultVariants: {
      intent: "neutral",
      size: "md",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Swaps content for a spinner and blocks interaction. */
    loading?: boolean;
  };

export function Button({
  className,
  intent,
  size,
  fullWidth,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ intent, size, fullWidth }), className)}
      disabled={disabled || loading}
      // Communicates the pending state to assistive tech, which cannot see a spinner.
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <SpinnerIcon className="size-4" />}
      {children}
    </button>
  );
}
