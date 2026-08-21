import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { AlertTriangleIcon, LayersIcon, RefreshIcon } from "./icons";

/**
 * Empty and error states.
 *
 * These are the same shape on purpose — icon, one line of what happened, one
 * line of what to do, and at most one action. Making them structurally
 * identical means a panel's height does not jump as it moves between empty,
 * failed and loaded, and it forces the honest question for every surface:
 * what is the one thing the user can do from here?
 *
 * Three tone rules, all of which the token layer will happily let you break:
 *
 * - An empty state is not a failure. It gets tertiary text and a hollow icon,
 *   never a red or amber tint. "No open positions" is the normal state of a
 *   new account.
 * - An error state is `danger`, never `sell`. Red on this screen means SHORT
 *   everywhere else, so the error icon carries a triangle and the heading
 *   carries the word — colour is never doing the work alone.
 * - The retry button is `neutral`, not solid `danger`. Solid danger is
 *   reserved for a committed destructive action inside a confirm dialog;
 *   retrying a failed fetch destroys nothing.
 */

const stateVariants = cva(
  "flex flex-col items-center justify-center text-center",
  {
    variants: {
      size: {
        /** Inside a table body or a book rail — must not force the panel taller. */
        sm: "gap-1.5 px-4 py-6",
        /** A whole panel with nothing in it. */
        md: "gap-2 px-6 py-10",
        /** A full route or an empty page. */
        lg: "gap-3 px-6 py-16",
      },
    },
    defaultVariants: { size: "md" },
  },
);

const iconWrapVariants = cva(
  "flex items-center justify-center rounded-full border",
  {
    variants: {
      size: {
        sm: "mb-0.5 size-8",
        md: "mb-1 size-10",
        lg: "mb-2 size-12",
      },
      tone: {
        neutral: "border-border-subtle bg-surface-inset text-text-disabled",
        /* Muted fill, not a solid one — a failed table is not an alarm. */
        danger: "border-danger-muted bg-danger-muted text-danger-400",
      },
    },
    defaultVariants: { size: "md", tone: "neutral" },
  },
);

const titleSize = {
  sm: "text-body-sm",
  md: "text-body-md",
  lg: "text-heading-sm",
} as const;

type StateSize = "sm" | "md" | "lg";

export type EmptyStateProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof stateVariants> & {
    /** What is not here. A noun phrase — "No open positions". */
    title: string;
    /** How to make it not empty. One sentence, optional. */
    description?: React.ReactNode;
    /** Defaults to a neutral structural glyph; pass one that fits the surface. */
    icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    action?: React.ReactNode;
  };

export function EmptyState({
  className,
  size = "md",
  title,
  description,
  icon: Icon = LayersIcon,
  action,
  ...props
}: EmptyStateProps) {
  const s = (size ?? "md") as StateSize;
  return (
    <div className={cn(stateVariants({ size }), className)} {...props}>
      <span className={iconWrapVariants({ size, tone: "neutral" })}>
        <Icon className={s === "sm" ? "size-4" : "size-5"} />
      </span>
      <p className={cn(titleSize[s], "font-medium text-text-secondary")}>
        {title}
      </p>
      {description && (
        <p className="max-w-[38ch] text-caption leading-relaxed text-text-tertiary">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export type ErrorStateProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof stateVariants> & {
    /** Plain language, no error codes. "Couldn't load the order book". */
    title?: string;
    description?: React.ReactNode;
    /**
     * The raw message, shown in mono beneath the copy.
     *
     * Kept because this is a trading client talking to services that fail in
     * specific ways, and "something went wrong" wastes the one piece of
     * information that would let someone report it. Mono, tertiary, small —
     * present for whoever needs it, ignorable by whoever does not.
     */
    detail?: string;
    onRetry?: () => void;
    retryLabel?: string;
  };

export function ErrorState({
  className,
  size = "md",
  title = "Something went wrong",
  description,
  detail,
  onRetry,
  retryLabel = "Try again",
  ...props
}: ErrorStateProps) {
  const s = (size ?? "md") as StateSize;
  return (
    <div
      // `alert` is assertive: an error that interrupts what the user is reading
      // is the correct trade when their data failed to arrive.
      role="alert"
      className={cn(stateVariants({ size }), className)}
      {...props}
    >
      <span className={iconWrapVariants({ size, tone: "danger" })}>
        <AlertTriangleIcon className={s === "sm" ? "size-4" : "size-5"} />
      </span>
      <p className={cn(titleSize[s], "font-medium text-text-primary")}>
        {title}
      </p>
      {description && (
        <p className="max-w-[42ch] text-caption leading-relaxed text-text-tertiary">
          {description}
        </p>
      )}
      {detail && (
        <code className="mt-0.5 max-w-full truncate font-mono text-micro text-text-disabled">
          {detail}
        </code>
      )}
      {onRetry && (
        <Button
          intent="neutral"
          size={s === "sm" ? "sm" : "md"}
          onClick={onRetry}
          className="mt-2"
        >
          <RefreshIcon className="size-3.5" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
