import NextLink from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const linkVariants = cva(
  [
    "rounded-xs underline-offset-2",
    "transition-colors duration-fast ease-out-quart",
    "focus-visible:outline-none focus-visible:shadow-focus",
    "forced-colors:focus-visible:outline-2",
  ],
  {
    variants: {
      intent: {
        primary: "text-text-link hover:underline",
        subtle: "text-text-secondary hover:text-text-primary hover:underline",
        /** For links sitting inside running copy, where underline is the cue. */
        inline: "text-text-link underline decoration-text-link/40 hover:decoration-text-link",
      },
      size: {
        sm: "text-body-sm",
        md: "text-body-md",
      },
    },
    defaultVariants: { intent: "primary", size: "sm" },
  },
);

export type TextLinkProps = React.ComponentProps<typeof NextLink> &
  VariantProps<typeof linkVariants> & {
    /** Adds the security attributes that external targets require. */
    external?: boolean;
  };

export function TextLink({
  className,
  intent,
  size,
  external,
  ...props
}: TextLinkProps) {
  return (
    <NextLink
      className={cn(linkVariants({ intent, size }), className)}
      {...(external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : undefined)}
      {...props}
    />
  );
}
