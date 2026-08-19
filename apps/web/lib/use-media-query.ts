"use client";

import { useSyncExternalStore } from "react";

/**
 * Media query as reactive state.
 *
 * Needed because CSS-only responsive branching (`lg:hidden` beside
 * `hidden lg:flex`) MOUNTS BOTH TREES — CSS hides one, React still runs it.
 * That cost two lightweight-charts instances and two kline fetches on the
 * terminal. Use CSS for anything cheap, and this hook only where a duplicate
 * mount is actually expensive or would fork component state.
 *
 * `useSyncExternalStore` gives a defined server snapshot, so SSR renders the
 * mobile branch and the client corrects on hydration without a mismatch warning.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    // Server snapshot: assume small screen, matching the mobile-first CSS.
    () => false,
  );
}

/** Matches the `lg` breakpoint token — the point the three-column rail appears. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}

/**
 * True only after hydration has finished.
 *
 * Anything that BRANCHES THE TREE on a media query needs this. The server has
 * no viewport, so it renders the small-screen branch; a desktop client renders
 * the large one — different tree shapes, which shifts React's `useId` counter
 * and produces ids that do not match. That surfaced as a hydration error from
 * Radix Tabs, several components away from the actual cause.
 *
 * Gating on this makes SSR and the first client render identical, and the real
 * layout appears on the commit straight after.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
