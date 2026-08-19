"use client";

import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/cn";

/**
 * The default scrollable region for the app.
 *
 * Replaces raw `overflow-y-auto` plus the old `.scrollbar-thin` utility, which
 * relied on `scrollbar-width` (Firefox/Chromium only) and `::-webkit-scrollbar`
 * (WebKit/Blink only) — two non-overlapping vendor mechanisms that Safari and
 * Firefox each honour differently, so the scrollbar looked different per engine.
 *
 * Radix renders its own scrollbar as an OVERLAY: it sits on top of the content
 * rather than taking layout width. That matters more than the styling here —
 * a native scrollbar appearing mid-stream narrows the content box and reflows
 * every row under it, which is what made the trades feed flicker as prints
 * arrived. An overlay scrollbar cannot cause that.
 *
 * Native scrolling, keyboard and wheel behaviour are all preserved; only the
 * scrollbar's appearance is ours.
 */
export function ScrollArea({
  className,
  viewportClassName,
  orientation = "vertical",
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
  /** Applied to the scrolling viewport, not the outer box. */
  viewportClassName?: string;
  orientation?: "vertical" | "horizontal" | "both";
}) {
  return (
    <ScrollAreaPrimitive.Root
      type="hover"
      scrollHideDelay={400}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        // `[&>div]` targets Radix's internal content wrapper, which is display:
        // table by default and would otherwise break flex children inside it.
        className={cn(
          "size-full [&>div]:!block",
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>

      {(orientation === "vertical" || orientation === "both") && (
        <Bar orientation="vertical" />
      )}
      {(orientation === "horizontal" || orientation === "both") && (
        <Bar orientation="horizontal" />
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function Bar({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const vertical = orientation === "vertical";
  return (
    <ScrollAreaPrimitive.Scrollbar
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-0.5",
        "transition-opacity duration-base ease-out-quart",
        "data-[state=hidden]:opacity-0",
        vertical ? "w-2" : "h-2 flex-col",
      )}
    >
      <ScrollAreaPrimitive.Thumb
        className={cn(
          "relative flex-1 rounded-full bg-border-strong",
          "transition-colors duration-fast",
          "hover:bg-text-disabled",
          // Widen the grab target beyond the visible thumb — a 6px bar is hard
          // to hit, and the pseudo-element costs no layout.
          "before:absolute before:top-1/2 before:left-1/2 before:size-full",
          "before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2",
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
