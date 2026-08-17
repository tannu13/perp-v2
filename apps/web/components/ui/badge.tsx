import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { CloseIcon } from "./icons";

export const badgeVariants = cva(
  [
    "inline-flex shrink-0 items-center gap-1 rounded-sm font-medium whitespace-nowrap",
    "font-mono uppercase",
  ],
  {
    variants: {
      intent: {
        neutral: "bg-surface-modal text-text-secondary",
        buy: "bg-buy-muted text-buy-text",
        sell: "bg-sell-muted text-sell-text",
        info: "bg-info-muted text-text-link",
        warning: "bg-warning-muted text-warning",
        danger: "bg-danger-muted text-danger-400",
        outline: "border border-border-default bg-transparent text-text-tertiary",
      },
      size: {
        sm: "h-4 px-1.5 text-[10px]",
        md: "h-5 px-2 text-micro",
      },
    },
    defaultVariants: { intent: "neutral", size: "md" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, intent, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ intent, size }), className)} {...props} />
  );
}

export type TagProps = React.HTMLAttributes<HTMLSpanElement> & {
  onRemove?: () => void;
  label: string;
};

/** A badge that can be dismissed — used for active filters on the tab panels. */
export function Tag({ className, label, onRemove, ...props }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-border-default bg-surface-raised py-0.5 pl-2 text-caption text-text-secondary",
        onRemove ? "pr-1" : "pr-2",
        className,
      )}
      {...props}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="flex size-4 items-center justify-center rounded-xs text-text-tertiary transition-colors duration-fast hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus"
        >
          <CloseIcon className="size-3" />
        </button>
      )}
    </span>
  );
}

export const statusDotVariants = cva("inline-block shrink-0 rounded-full", {
  variants: {
    intent: {
      online: "bg-buy",
      offline: "bg-text-disabled",
      warning: "bg-warning",
      danger: "bg-danger",
      info: "bg-interactive",
    },
    size: { sm: "size-1.5", md: "size-2" },
  },
  defaultVariants: { intent: "online", size: "md" },
});

export type StatusDotProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof statusDotVariants> & {
    /** Connection-state dots pulse; static status dots should not. */
    pulse?: boolean;
    /** Accessible text — a bare colored dot conveys nothing to a screen reader. */
    label: string;
  };

export function StatusDot({
  className,
  intent,
  size,
  pulse,
  label,
  ...props
}: StatusDotProps) {
  return (
    <span className="inline-flex items-center" {...props}>
      <span
        className={cn(
          statusDotVariants({ intent, size }),
          pulse && "animate-pulse",
          className,
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
