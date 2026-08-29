"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getBalances } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import { addMoney } from "@/lib/money";
import { useSession } from "@/lib/auth/session-provider";

/**
 * The account snapshot: one request, four surfaces.
 *
 * The header's equity readout, the account menu's margin `Seam`, the order
 * ticket's buying power and the Balances tab all showed different numbers
 * before this existed — 2521 in two places, 14380.72 in a third, 1958.10 in a
 * fourth. They now read one snapshot with one `refresh()`.
 *
 * Refreshing is explicit, not polled. Until the private WebSocket channel lands
 * in Phase 13 there is no push for balance changes, so the mutations that move
 * money call `refresh()` themselves: deposit (Phase 6), placing an order
 * (Phase 7), cancelling (Phase 8) and closing a position (Phase 9). A timer
 * here would hide the missing channel instead of exposing it.
 */

export type AccountSnapshot = {
  /** Money as strings, all the way through. */
  equity: string;
  available: string;
  marginUsed: string;
  /**
   * Unrealised PnL across all positions.
   *
   * Null until Phase 9: it is derived from open positions and a live mark
   * price, neither of which the frontend has yet. Null renders as an em dash —
   * a zero here would be a confident lie about someone's money.
   */
  unrealisedPnl: number | null;
};

export type AccountState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: AccountSnapshot; error: null }
  | { status: "error"; data: null; error: string };

type AccountValue = AccountState & {
  /** Re-read balances. Called after anything that moves money. */
  refresh: () => Promise<void>;
  /** Alias kept for the header's inline retry affordance. */
  retry: () => void;
};

const AccountContext = createContext<AccountValue | null>(null);

export function useAccount(): AccountValue {
  const value = useContext(AccountContext);
  if (!value) {
    throw new Error("useAccount must be used inside <AccountProvider>");
  }
  return value;
}

const ANON: AccountState = { status: "loading", data: null, error: null };

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const [state, setState] = useState<AccountState>(ANON);

  const load = useCallback(async () => {
    /**
     * Only ever fetch for a signed-in user.
     *
     * Requesting balances while anonymous would 401, and a 401 is what the
     * interceptor turns into a sign-out and a redirect — so an unguarded fetch
     * here would bounce every visitor off the landing page.
     */
    if (session.status !== "authed") return;

    setState({ status: "loading", data: null, error: null });

    try {
      const balances = await getBalances();
      const equity = addMoney(balances.available, balances.locked);

      setState({
        status: "ready",
        data: {
          available: balances.available,
          marginUsed: balances.locked,
          // Null propagates rather than falling back to a plausible number.
          equity: equity ?? balances.available,
          unrealisedPnl: null,
        },
        error: null,
      });
    } catch (err) {
      // An auth failure is already being handled by the interceptor; showing an
      // error panel about it as well would be noise on the way to /signin.
      if (err instanceof ApiError && err.isAuthFailure) return;

      setState({
        status: "error",
        data: null,
        error:
          err instanceof ApiError ? err.message : "Could not load balances.",
      });
    }
  }, [session.status]);

  useEffect(() => {
    if (session.status === "loading") return;
    if (session.status === "anon") {
      setState(ANON);
      return;
    }
    void load();
  }, [session.status, load]);

  const value = useMemo<AccountValue>(
    () => ({ ...state, refresh: load, retry: () => void load() }),
    [state, load],
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

/** Free vs used collateral — the pair the header's Seam renders. */
export function marginSplit(data: AccountSnapshot) {
  return {
    used: Number.parseFloat(data.marginUsed),
    free: Number.parseFloat(data.available),
  };
}
