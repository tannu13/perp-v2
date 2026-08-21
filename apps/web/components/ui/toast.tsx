"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  CloseIcon,
  InfoIcon,
} from "./icons";

/**
 * Toasts, on Radix.
 *
 * Another overlay worth not hand-rolling: Radix gives us a correct ARIA live
 * region, a hotkey (F8) that jumps focus into the stack, pause-on-hover and
 * pause-on-window-blur, swipe-to-dismiss, and — the part that is genuinely hard
 * — it keeps a toast mounted while its exit animation runs, so dismissal is not
 * a race between a timer and a transition.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO `buy` / `sell` INTENT HERE
 *
 * The primary use of this system is fill confirmations, which are inherently
 * directional — and directional is exactly what a toast must not be. Green on
 * this screen means LONG. A green-bordered toast reading "Filled" would be
 * claiming a direction it does not have, and a green FILLED sitting beside a
 * green LONG badge is unreadable.
 *
 * So the split is: the toast *container* carries status only (neutral, info,
 * success, warning, danger) and direction lives in the *content*, rendered with
 * `Side`, which always prints the word. See `fill-toast.tsx` for how a fill
 * composes the two. `--color-success` aliases the long green, so the token
 * layer will not catch a violation here — this comment is the guard.
 * ---------------------------------------------------------------------------
 */

/* ------------------------------------------------------------------ model -- */

export type ToastIntent = "neutral" | "info" | "success" | "warning" | "danger";

export type ToastOptions = {
  title: React.ReactNode;
  description?: React.ReactNode;
  intent?: ToastIntent;
  /** ms on screen. Radix pauses this on hover and on window blur. */
  duration?: number;
  /**
   * Radix requires `altText` on an action: screen-reader users cannot click a
   * toast before it expires, so the alt text tells them how to reach the same
   * outcome elsewhere ("Open the orders tab to cancel").
   */
  action?: { label: string; altText: string; onClick: () => void };
  /** Suppress the leading status glyph — fills draw their own directional mark. */
  hideIcon?: boolean;
};

type ToastRecord = ToastOptions & { id: number; open: boolean };

type ToastContextValue = {
  /** Show a toast. Returns its id so it can be dismissed early. */
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

/**
 * Hard cap on the visible stack.
 *
 * Not a nicety. A market order against a thin book fills in several partials
 * and this app is push-driven, so an uncapped queue can put a dozen toasts on
 * screen in a second and bury the market bar behind them. Oldest is evicted,
 * because in a fill sequence the most recent is the one that still matters.
 */
const MAX_VISIBLE = 4;

/**
 * How long to keep a dismissed record around before dropping it from state.
 *
 * `animationend` on the exit is the precise signal and is what normally fires.
 * This is the safety net for the case where it never does: CSS animations do
 * not advance in a throttled background tab, so a toast that expires while the
 * user is in another tab would animate never, fire nothing, and sit in the
 * array forever — eventually starving the visible cap. Comfortably longer than
 * `--duration-fast`, which is what the exit runs at.
 */
const EXIT_GRACE_MS = 400;

/* --------------------------------------------------------------- provider -- */

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      // Flip `open` rather than splicing: Radix keeps the node mounted for the
      // exit animation and unmounts it itself. Removing it from state here
      // would make it disappear instantly.
      setItems((prev) =>
        prev.map((t) => (t.id === id ? { ...t, open: false } : t)),
      );
      window.setTimeout(() => remove(id), EXIT_GRACE_MS);
    },
    [remove],
  );

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setItems((prev) => {
        const next: ToastRecord[] = [...prev, { ...options, id, open: true }];
        const live = next.filter((t) => t.open);
        const evicted = live.slice(0, Math.max(0, live.length - MAX_VISIBLE));
        if (evicted.length === 0) return next;

        // Evicted toasts are closed, not deleted, so the oldest animates out
        // instead of blinking away under the newest. `remove` is idempotent, so
        // React re-running this updater in StrictMode costs a duplicate timer
        // and nothing else.
        const evictedIds = new Set(evicted.map((t) => t.id));
        for (const t of evicted) {
          window.setTimeout(() => remove(t.id), EXIT_GRACE_MS);
        }
        return next.map((t) =>
          evictedIds.has(t.id) ? { ...t, open: false } : t,
        );
      });
      return id;
    },
    [remove],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {/* `swipeDirection` must match the axis the viewport is docked on, or the
          gesture fights the entrance animation. Right, for both breakpoints. */}
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((t) => (
          <ToastItem
            key={t.id}
            {...t}
            onClosed={() => remove(t.id)}
            onDismiss={() => dismiss(t.id)}
          />
        ))}
        <ToastViewport />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

function ToastViewport() {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        // `flex-col-reverse` so the newest toast sits nearest the docked edge.
        // With plain `flex-col` the oldest would be at the top and the whole
        // stack would jump upward each time one expired; reversed, expiry
        // removes from the far end and nothing above it moves.
        "fixed z-100 flex max-h-dvh list-none flex-col-reverse gap-2 outline-none",
        // Both breakpoints dock to the TOP, offset by the header.
        //
        // Bottom-right put the toast in dead space at the foot of the order
        // rail, diagonally opposite the centre-screen dialog the user had just
        // dismissed — so the confirmation appeared exactly where nobody was
        // looking. Top-right is beside the equity readout and the account menu,
        // which is where account-level events belong and where the eye already
        // goes after a fill.
        //
        // The `--size-header` offset is deliberate: docking at top-0 would
        // cover the Deposit button and the account menu, so a burst of fills
        // would block the controls the user reaches for *because* of the fills.
        // It covers the market bar instead, which is ambient.
        "inset-x-0 top-(--size-header) p-2",
        "sm:inset-x-auto sm:right-0 sm:w-(--size-toast) sm:p-3",
      )}
    />
  );
}

/* ------------------------------------------------------------------- item -- */

const toastVariants = cva(
  [
    "group pointer-events-auto relative flex items-start gap-2.5",
    "rounded-lg border p-3 pr-9",
    // Top of the elevation ladder: the highest surface, the strongest border
    // and the deepest shadow in the system. A toast has to be legible against
    // whatever it lands on — a panel, the canvas, or a dialog it is covering —
    // and it is the one surface that cannot afford to be missed.
    "bg-surface-toast shadow-e4",
    // Entrance differs by edge; see the keyframes in tokens.css.
    "animate-toast-in-mobile sm:animate-toast-in",
    "data-[state=closed]:animate-toast-out",
    // Swipe. Radix exposes the live offset as a CSS variable during the drag,
    // and only transitions the release so the finger-tracking stays 1:1.
    "data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)",
    "data-[swipe=move]:transition-none",
    "data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=cancel]:duration-fast",
    "data-[swipe=end]:animate-toast-out",
  ],
  {
    variants: {
      /**
       * Status only — never direction. The left border is the carrier because
       * it tints without washing the surface, so a stack of four mixed toasts
       * still reads as one material.
       */
      intent: {
        // Neutral gets a stripe too, in plain grey. Every toast then has the
        // same anatomy, so the shape is recognisable before the words are —
        // and a fill, which is the most common toast and deliberately has no
        // status colour, no longer looks like an unstyled box next to the
        // others.
        neutral: "border-border-strong border-l-2 border-l-border-strong",
        info: "border-border-strong border-l-2 border-l-interactive",
        success: "border-border-strong border-l-2 border-l-success",
        warning: "border-border-strong border-l-2 border-l-warning",
        danger: "border-border-strong border-l-2 border-l-danger",
      },
    },
    defaultVariants: { intent: "neutral" },
  },
);

const ICONS: Record<
  ToastIntent,
  React.ComponentType<React.SVGProps<SVGSVGElement>> | null
> = {
  neutral: null,
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  danger: AlertCircleIcon,
};

const ICON_TONE: Record<ToastIntent, string> = {
  neutral: "text-text-tertiary",
  info: "text-text-link",
  // `success` aliases the long green by design. Legitimate here only because
  // the glyph is a check, which no directional surface in this app ever uses.
  success: "text-buy-text",
  warning: "text-warning",
  danger: "text-danger-400",
};

type ToastItemProps = ToastRecord & {
  onClosed: () => void;
  onDismiss: () => void;
};

function ToastItem({
  title,
  description,
  intent = "neutral",
  duration,
  action,
  hideIcon,
  open = true,
  onClosed,
  onDismiss,
}: ToastItemProps) {
  const Icon = hideIcon ? null : ICONS[intent];

  return (
    <ToastPrimitive.Root
      open={open}
      duration={duration}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      // Fires after the exit animation, which is where the record is actually
      // dropped from state.
      onAnimationEnd={() => {
        if (!open) onClosed();
      }}
      className={cn(toastVariants({ intent }))}
    >
      {Icon && (
        <Icon className={cn("mt-0.5 size-4 shrink-0", ICON_TONE[intent])} />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <ToastPrimitive.Title className="text-body-sm font-medium text-text-primary">
          {title}
        </ToastPrimitive.Title>
        {description && (
          <ToastPrimitive.Description className="text-caption leading-relaxed text-text-secondary">
            {description}
          </ToastPrimitive.Description>
        )}
        {action && (
          <ToastPrimitive.Action
            altText={action.altText}
            onClick={action.onClick}
            className={cn(
              "mt-1.5 self-start rounded-sm text-caption font-medium text-text-link",
              "transition-colors duration-fast hover:text-interactive-hover",
              "focus-visible:outline-none focus-visible:shadow-focus",
            )}
          >
            {action.label}
          </ToastPrimitive.Action>
        )}
      </div>

      <ToastPrimitive.Close
        aria-label="Dismiss"
        className={cn(
          "absolute top-2 right-2 flex size-6 items-center justify-center rounded-sm",
          "text-text-tertiary transition-colors duration-fast",
          "hover:bg-surface-hover hover:text-text-primary",
          "focus-visible:outline-none focus-visible:shadow-focus",
        )}
      >
        <CloseIcon className="size-3.5" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

export type ToastVariantProps = VariantProps<typeof toastVariants>;
export { toastVariants };
