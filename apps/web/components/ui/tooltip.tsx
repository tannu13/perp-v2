import { cn } from "@/lib/cn";

export type TooltipProps = {
  content: React.ReactNode;
  side?: "top" | "bottom";
  className?: string;
  children: React.ReactNode;
};

/**
 * CSS-only tooltip — no positioning library, no portal, no JS.
 *
 * Deliberately limited: it opens on hover AND keyboard focus, and cannot flip
 * or collide-detect. That is the right trade for labelling dense terminal chrome
 * where the trigger sits well inside the viewport. Anything needing real
 * placement logic (a chart crosshair readout, a nested menu) should not use this.
 *
 * `group-focus-within` is what makes it keyboard-reachable; a hover-only tooltip
 * is invisible to anyone not using a mouse.
 */
export function Tooltip({
  content,
  side = "top",
  className,
  children,
}: TooltipProps) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2",
          "rounded-md border border-border-default bg-surface-overlay px-2 py-1",
          "text-caption whitespace-nowrap text-text-primary shadow-e2",
          "opacity-0 transition-opacity duration-fast ease-out-quart",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
