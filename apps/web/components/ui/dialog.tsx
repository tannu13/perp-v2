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
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]",
          "data-[state=open]:animate-in data-[state=open]:fade-in",
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
              ]
            : [
                "top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
                "rounded-xl p-5",
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
