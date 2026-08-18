"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

/**
 * Tooltip, on Radix.
 *
 * Replaces the earlier CSS-only version, which opened on hover and focus but
 * could not flip or shift when it hit a viewport edge — a real problem for
 * chrome sitting near the right rail. Radix adds collision detection, a shared
 * open/close delay across the app, and correct `role="tooltip"` wiring.
 *
 * `TooltipProvider` belongs high in the tree (see app/layout.tsx) so hovering
 * between adjacent tooltips does not re-trigger the open delay each time.
 */
export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  side = "top",
  className,
  children,
}: {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "z-50 max-w-[260px] rounded-md border border-border-default bg-surface-overlay",
            "px-2 py-1 text-caption text-text-primary shadow-e2",
            "select-none",
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-surface-overlay" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
