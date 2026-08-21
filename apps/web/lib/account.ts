"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * STAND-IN for the account endpoints.
 *
 * Maps to `GET /order/equity/balances` plus whatever identity the JWT carries.
 * Neither is wired: there is no API client yet, and the decision recorded for
 * integration is that the JWT moves into an httpOnly cookie, which is a backend
 * change. Replace this module with a real fetch; the shape below is what the
 * header, the account menu and the deposit dialog consume.
 *
 * It models `loading` and `error` as first-class states rather than resolving
 * instantly, because those are the states this phase is building UI for — a
 * mock that always succeeds immediately means the skeleton and the error path
 * ship untested. The delay is deliberate and is a placeholder, not a design
 * choice.
 */

export type AccountSnapshot = {
  /** Deposit address / account id. Rendered in mono and truncated. */
  address: string;
  email: string;
  /** Money as strings, all the way through. */
  equity: string;
  available: string;
  marginUsed: string;
  /** Unrealised PnL is a number because `Delta` needs a sign to compare. */
  unrealisedPnl: number;
};

export type AccountState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: AccountSnapshot; error: null }
  | { status: "error"; data: null; error: string };

const SNAPSHOT: AccountSnapshot = {
  address: "6Y2mVpQKcH8s1TfQ9xLZa4Rn7dVuJp3WgB5kNcE1oXsA",
  email: "trader@perp.dev",
  equity: "14380.72",
  available: "11858.10",
  marginUsed: "2522.62",
  unrealisedPnl: 412.38,
};

/** TODO(api): swap the timer for a fetch. Kept long enough to see the skeleton. */
const SIMULATED_LATENCY_MS = 900;

export function useAccount(): AccountState & { retry: () => void } {
  const [state, setState] = useState<AccountState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Both the server render and the first client render are `loading`, so the
    // trees match and there is no hydration mismatch to chase. Resolution only
    // ever happens in this effect.
    let cancelled = false;
    setState({ status: "loading", data: null, error: null });

    const id = window.setTimeout(() => {
      if (cancelled) return;
      setState({ status: "ready", data: SNAPSHOT, error: null });
    }, SIMULATED_LATENCY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { ...state, retry };
}

/** Free vs used collateral — the pair the header's Seam renders. */
export function marginSplit(data: AccountSnapshot) {
  return {
    used: Number.parseFloat(data.marginUsed),
    free: Number.parseFloat(data.available),
  };
}
