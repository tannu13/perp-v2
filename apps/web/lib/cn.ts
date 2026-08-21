import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The type scale from tokens.css.
 *
 * tailwind-merge has to be told about this explicitly. Because tokens.css resets
 * `--text-*: initial`, none of Tailwind's stock size names (text-sm, text-base…)
 * exist here — so out of the box tailwind-merge cannot tell `text-body-md`
 * (a font size) from `text-buy-text` (a color) and will drop one of them when
 * both appear. Enumerating the scale is what keeps `cn()` from silently eating
 * a class. Keep in sync with the --text-* tokens.
 */
const FONT_SIZES = [
  "display-lg",
  "display-md",
  "heading-lg",
  "heading-md",
  "heading-sm",
  "body-lg",
  "body-md",
  "body-sm",
  "caption",
  "micro",
  "num-xl",
  "num-lg",
  "num-md",
  "num-sm",
] as const;

const SHADOWS = [
  "e0",
  "e1",
  "e2",
  "e3",
  "e4",
  "focus",
  "focus-error",
  "glow-buy",
  "glow-sell",
  "none",
] as const;

/** Named speeds registered via @utility — not part of Tailwind's numeric scale. */
const DURATIONS = ["instant", "fast", "base", "slow"] as const;

/**
 * Our `--animate-*` tokens, plus the Tailwind defaults we still rely on.
 *
 * Tailwind's stock animate group only knows spin/pulse/bounce/ping/none, so an
 * unlisted custom name is unclassifiable — and an unclassified class is not
 * merged, it is silently passed through *and* never allowed to override.
 * `animate-toast-in data-[state=closed]:animate-toast-out` needs both sides
 * recognised as the same group for the exit to win.
 */
const ANIMATIONS = [
  "flash-buy",
  "flash-sell",
  "shimmer",
  "overlay-in",
  "overlay-out",
  "dialog-in",
  "dialog-out",
  "sheet-in",
  "sheet-out",
  "menu-in",
  "menu-out",
  "toast-in",
  "toast-out",
  "toast-in-mobile",
  "spin",
  "pulse",
  "none",
] as const;

const twMerge = extendTailwindMerge({
  override: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZES] }],
      shadow: [{ shadow: [...SHADOWS] }],
      animate: [{ animate: [...ANIMATIONS] }],
    },
  },
  extend: {
    classGroups: {
      duration: [{ duration: [...DURATIONS] }],
    },
  },
});

/** Compose class names, with later Tailwind utilities winning conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
