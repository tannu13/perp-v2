"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Dropdown menu, on Radix.
 *
 * Third overlay in the "behaviour-heavy, do not hand-roll" set. What Radix is
 * buying here is roving focus with typeahead, correct `menu`/`menuitem` roles,
 * collision-aware placement, Escape and outside-click dismissal, and focus
 * returning to the trigger on close. A `<div>` with an onClick gets none of it,
 * and the failure mode is keyboard users being unable to leave the menu.
 *
 * The account menu is the only consumer today. It is a general atom anyway,
 * because the market selector in the header is next and will want the same
 * behaviour with different content.
 */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "end",
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 min-w-(--size-account-menu) overflow-hidden rounded-lg p-1",
          "border border-border-default bg-surface-overlay shadow-e3",
          "focus-visible:outline-none",
          // Radix reports which edge it actually placed against, so the menu
          // grows away from its trigger even after a collision flip.
          "animate-menu-in data-[state=closed]:animate-menu-out",
          "data-[side=bottom]:origin-top data-[side=top]:origin-bottom",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

const menuItemVariants = cva(
  [
    "relative flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2",
    "text-body-sm outline-none",
    "transition-colors duration-instant",
    // `highlighted` rather than `hover`: Radix sets it for both the pointer and
    // the keyboard, so arrowing through the menu looks identical to mousing
    // through it. A plain :hover rule leaves keyboard users with no cursor.
    "data-[highlighted]:bg-surface-hover",
    "data-[disabled]:pointer-events-none data-[disabled]:text-text-disabled",
  ],
  {
    variants: {
      intent: {
        neutral: "text-text-secondary data-[highlighted]:text-text-primary",
        /**
         * Quiet destructive, matching Button's `danger-ghost`: neutral at rest,
         * red on highlight. A menu that is red before you reach the item is
         * shouting at everyone who opened it for something else.
         */
        danger:
          "text-text-secondary data-[highlighted]:bg-danger-muted data-[highlighted]:text-danger-400",
      },
    },
    defaultVariants: { intent: "neutral" },
  },
);

export function DropdownMenuItem({
  className,
  intent,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> &
  VariantProps<typeof menuItemVariants>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(menuItemVariants({ intent }), className)}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        "px-2.5 pt-2 pb-1.5 text-micro uppercase text-text-tertiary",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border-subtle", className)}
      {...props}
    />
  );
}

/** Trailing metadata inside an item — a balance, a shortcut, a chevron. */
export function DropdownMenuMeta({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("ml-auto pl-4 text-caption text-text-tertiary", className)}
      {...props}
    />
  );
}

export { menuItemVariants };
