import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { focusRing } from "./button";

export const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center rounded-md",
    "transition-colors duration-fast ease-out-quart",
    ...focusRing,
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-text-disabled",
  ],
  {
    variants: {
      intent: {
        ghost:
          "bg-transparent text-text-tertiary hover:bg-surface-hover hover:text-text-primary active:bg-surface-active",
        neutral:
          "border border-border-strong bg-surface-raised text-text-secondary hover:bg-surface-hover hover:text-text-primary active:bg-surface-active",
        danger:
          "bg-transparent text-text-tertiary hover:bg-danger-muted hover:text-danger active:bg-danger-muted",
      },
      size: {
        sm: "size-7 [&_svg]:size-3.5",
        md: "size-9 [&_svg]:size-4",
        lg: "size-11 [&_svg]:size-5",
      },
    },
    defaultVariants: { intent: "ghost", size: "md" },
  },
);

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof iconButtonVariants> & {
    /** Required — an icon-only control has no accessible name otherwise. */
    label: string;
  };

export function IconButton({
  className,
  intent,
  size,
  label,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      className={cn(iconButtonVariants({ intent, size }), className)}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
