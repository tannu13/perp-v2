import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const avatarVariants = cva(
  "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none",
  {
    variants: {
      size: {
        sm: "size-6 text-[10px]",
        md: "size-8 text-caption",
        lg: "size-10 text-body-sm",
      },
      intent: {
        neutral: "bg-surface-modal text-text-secondary",
        accent: "bg-secondary-500 text-white",
        interactive: "bg-interactive text-white",
      },
    },
    defaultVariants: { size: "md", intent: "neutral" },
  },
);

export type AvatarProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof avatarVariants> & {
    /** Full name or username — initials are derived from it. */
    name: string;
    src?: string;
  };

/** Derives at most two initials, ignoring empty segments from stray spaces. */
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({
  className,
  name,
  src,
  size,
  intent,
  ...props
}: AvatarProps) {
  return (
    <span
      className={cn(avatarVariants({ size, intent }), className)}
      // The image is decorative; the name is already available in context, so
      // announcing initials would just add noise.
      role={src ? undefined : "img"}
      aria-label={src ? undefined : name}
      title={name}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="size-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
