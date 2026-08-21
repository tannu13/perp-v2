"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import { CloseIcon } from "./icons";

/**
 * Dialog / bottom sheet, on Radix.
 *
 * This is the class of component worth NOT hand-rolling: focus is trapped and
 * restored to the trigger on close, the background is inert to pointer and
 * screen-reader traversal, body scroll is locked, Escape and outside-click
 * dismiss, and title/description are wired to aria-labelledby/describedby.
 * Those are easy to get subtly wrong and expensive to discover late.
 *
 * Styling is entirely our own tokens — Radix ships behaviour, not appearance,
 * so nothing here introduces a second design vocabulary.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  /** On mobile the sheet enters from the bottom; on md+ it is a centred modal. */
  sheetOnMobile = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  sheetOnMobile?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      {/*
        Entrance and exit animations come from our own `--animate-*` tokens.
        They previously read `animate-in fade-in`, which are tailwindcss-animate
        plugin classes — that plugin is not installed, so those compiled to
        nothing and every dialog hard-cut into view. A green build the whole
        time; see the verification note in CLAUDE.md.

        Radix keeps the element mounted while a CSS animation is running on it,
        so `data-[state=closed]` exits work without any JS timing on our side.
      */}
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]",
          "animate-overlay-in data-[state=closed]:animate-overlay-out",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col gap-4 border border-border-default bg-surface-modal shadow-e3",
          "focus-visible:outline-none",
          sheetOnMobile
            ? [
                "inset-x-0 bottom-0 rounded-t-xl p-5 pb-8",
                "md:inset-auto md:top-1/2 md:left-1/2 md:w-full md:max-w-md",
                "md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:p-5 md:pb-5",
                // The sheet rises from the bottom edge; the desktop modal scales
                // from the centre. They need different keyframes because the
                // centred one has to carry its own -50%/-50% offset through the
                // animation, and a shared keyframe would fight the sheet.
                "animate-sheet-in data-[state=closed]:animate-sheet-out",
                "md:animate-dialog-in md:data-[state=closed]:animate-dialog-out",
              ]
            : [
                "top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
                "rounded-xl p-5",
                "animate-dialog-in data-[state=closed]:animate-dialog-out",
              ],
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Close"
          className={cn(
            "absolute top-4 right-4 flex size-7 items-center justify-center rounded-md",
            "text-text-tertiary transition-colors duration-fast",
            "hover:bg-surface-hover hover:text-text-primary",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          <CloseIcon className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-heading-sm text-text-primary", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-body-sm text-text-secondary", className)}
      {...props}
    />
  );
}
