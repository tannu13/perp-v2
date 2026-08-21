import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Loading placeholders.
 *
 * Two rules govern everything in this file.
 *
 * 1. A skeleton must occupy the exact geometry of the content it stands in for.
 *    The point of a skeleton over a spinner is that nothing moves when the data
 *    lands — if the placeholder is the wrong height, it is a worse spinner. So
 *    the row skeletons here are pinned to `--size-row`, the same token the
 *    order book and trades feed use for a real row.
 *
 * 2. At rest, a skeleton block and an empty panel are the same rectangle. The
 *    sweep is the only thing that distinguishes "still loading" from "there is
 *    nothing here" — which is why the sheen is a token and not decoration, and
 *    why empty states get their own component rather than an idle skeleton.
 *
 * Under `prefers-reduced-motion` the global rule in globals.css collapses the
 * sweep. That is intended: the skeleton degrades to a static block, and the
 * `role="status"` on SkeletonRegion still announces the loading state.
 */

export const skeletonVariants = cva(
  "relative overflow-hidden bg-skeleton-base",
  {
    variants: {
      shape: {
        block: "rounded-md",
        text: "rounded-xs",
        pill: "rounded-full",
        circle: "aspect-square rounded-full",
      },
    },
    defaultVariants: { shape: "block" },
  },
);

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof skeletonVariants>;

export function Skeleton({ className, shape, ...props }: SkeletonProps) {
  return (
    <div
      // Individually hidden from assistive tech — a screen reader gains nothing
      // from twelve empty boxes. SkeletonRegion announces the state once.
      aria-hidden
      className={cn(skeletonVariants({ shape }), className)}
      {...props}
    >
      {/*
        The sweep is a child rather than a background-position animation so it
        animates `transform` only, which the compositor can run off the main
        thread. Skeletons routinely share a screen with a live chart and a
        ticking order book, and this is the one animation on the page that never
        stops.
      */}
      <span className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-skeleton-sheen to-transparent" />
    </div>
  );
}

/**
 * Announces a loading region once, for the skeletons inside it.
 *
 * `role="status"` is a polite live region: it does not interrupt, which is
 * correct for content arriving on its own. `aria-busy` marks the subtree as
 * in-flight so assistive tech does not read a half-built table.
 */
export function SkeletonRegion({
  label,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { label: string }) {
  return (
    <div role="status" aria-busy className={className} {...props}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * Paragraph placeholder. The last line is short because real prose ends
 * mid-measure — equal-length bars read as a table, not text.
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          shape="text"
          className="h-3"
          style={{ width: i === lines - 1 ? "62%" : "100%" }}
        />
      ))}
    </div>
  );
}

/**
 * Ladder placeholder for the order book and trades feed.
 *
 * Widths taper down the list. A uniform stack of bars looks like a barcode and
 * reads as a rendering bug; the taper mimics the shape of real depth, where
 * sizes vary row to row.
 */
export function SkeletonRows({
  rows = 8,
  columns = 3,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          // Pinned to the same row token the real ladder uses, so the swap from
          // skeleton to data moves nothing.
          className="flex items-center gap-3 h-(--size-row)"
        >
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton
              key={c}
              shape="text"
              className="h-2.5 flex-1"
              // Deterministic, not random: a random width would differ between
              // the server render and the client and trip a hydration mismatch.
              style={{ opacity: 1 - r * 0.055, width: `${72 - c * 8}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Placeholder for the account tables (positions, open orders, fills).
 *
 * Renders a real `<table>` so column widths resolve the same way they will with
 * data in them, rather than a stack of divs that happens to look similar.
 */
export function SkeletonTable({
  rows = 4,
  columns,
  className,
}: {
  rows?: number;
  columns: string[];
  className?: string;
}) {
  return (
    <table className={cn("w-full border-collapse", className)}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c}
              className="whitespace-nowrap px-3 py-2 text-left text-micro uppercase font-medium text-text-tertiary"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r} className="border-t border-border-subtle">
            {columns.map((c, i) => (
              <td key={c} className="px-3 py-2.5">
                <Skeleton
                  shape="text"
                  className="h-3"
                  style={{ width: i === 0 ? "72%" : "54%" }}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
