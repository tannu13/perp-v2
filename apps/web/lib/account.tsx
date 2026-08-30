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
import { useUserFeedSubscription } from "@/lib/user-feed";
import type { UserEvent } from "@/lib/user-feed-core";

/**
 * The account snapshot: one request, four surfaces.
 *
 * The header's equity readout, the account menu's margin `Seam`, the order
 * ticket's buying power and the Balances tab all showed different numbers
 * before this existed — 2521 in two places, 14380.72 in a third, 1958.10 in a
 * fourth. They now read one snapshot with one `refresh()`.
 *
 * Balances arrive by push as of Phase 13. Every engine reply that moves money
 * ends with a `balance` event carrying the account's collateral in absolute
 * terms — including a deposit, which is the one balance change with no order
 * behind it. The four `refresh()` calls the mutations used to make (deposit,
 * placing an order, cancelling, closing) are gone; what is left is the
 * snapshot: one fetch on mount, and one on every reconnect of the channel.
 *
 * `refresh` itself survives as the retry affordance the header renders on an
 * error, which is a user asking rather than a mutation compensating.
 */

export type AccountSnapshot = {
  /** Money as strings, all the way through. */
  equity: string;
  available: string;
  marginUsed: string;
};

/*
 * `unrealisedPnl` used to sit on this snapshot as a permanent `null`, waiting
 * for Phase 9. Phase 9 did not put a number in it: unrealised PnL is derived
 * from open positions and a mark, both of which belong to `PositionsProvider`,
 * and that provider only mounts inside the terminal. The header and the account
 * menu read `usePositionsOptional()` for it instead, so there is one definition
 * of the figure and it lives beside the rows it is a sum of.
 */

export type AccountState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: AccountSnapshot; error: null }
  | { status: "error"; data: null; error: string };

type AccountValue = AccountState & {
  /** Re-read balances. The retry affordance, and the channel's resync. */
  refresh: () => Promise<void>;
  /** Alias kept for the header's inline retry affordance. */
  retry: () => void;
  /**
   * Apply the free collateral a `POST /onramp` reply reported.
   *
   * NOT a refetch, and the distinction is the one this phase is built on: the
   * deposit response is the engine's own figure, arriving one hop earlier than
   * the `balance` event that carries the same number. The channel is still the
   * general answer — it is what makes a deposit on another device show up here
   * — but a deposit is the one balance change that has to work with the REST
   * layer alone, because it is how an account gets its first dollar and
   * everything else in the app is gated on having one.
   *
   * `locked` is carried over rather than guessed: an onramp cannot move it,
   * and the reply does not mention it.
   */
  applyDeposit: (available: string) => void;
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

    /**
     * A figure already on screen stays there while the request runs.
     *
     * This used to flip unconditionally to `loading`, which was harmless when
     * `load` ran once on mount. It runs on every reconnect of the private
     * channel now (it is this provider's resync), and blanking the header's
     * equity to a skeleton each time the socket blinked would be a worse lie
     * than the stale number it replaced.
     */
    setState((prev) =>
      prev.status === "ready" ? prev : { status: "loading", data: null, error: null },
    );

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

  /**
   * The push path.
   *
   * A `balance` event is absolute — `available` and `locked` as the engine
   * holds them after the reply — so this is an assignment, never arithmetic on
   * what is already here. `equity` is recomputed from the pair by the same
   * `addMoney` the snapshot uses, so the header can never disagree with the
   * Balances tab about a number they both call collateral.
   *
   * Only the LAST balance event of a batch matters, and folding the array is
   * how that falls out: one engine reply can move an account's collateral more
   * than once (a fill that closes a position releases margin and realises PnL),
   * and only the final figure was ever true.
   */
  useUserFeedSubscription({
    resync: load,
    onEvents: (events: UserEvent[]) => {
      const latest = [...events].reverse().find((e) => e.type === "balance");
      if (!latest) return;

      setState((prev) => {
        // Before the first snapshot there is nothing to update, and `load` is
        // already in flight with a newer read than this event.
        if (prev.status !== "ready") return prev;
        const equity = addMoney(latest.available, latest.locked);
        return {
          status: "ready",
          data: {
            available: latest.available,
            marginUsed: latest.locked,
            equity: equity ?? latest.available,
          },
          error: null,
        };
      });
    },
  });

  const applyDeposit = useCallback((available: string) => {
    setState((prev) => {
      // Nothing to update before the first snapshot, which is already in
      // flight with a read newer than this reply.
      if (prev.status !== "ready") return prev;
      const equity = addMoney(available, prev.data.marginUsed);
      return {
        status: "ready",
        data: {
          available,
          marginUsed: prev.data.marginUsed,
          equity: equity ?? available,
        },
        error: null,
      };
    });
  }, []);

  const value = useMemo<AccountValue>(
    () => ({ ...state, refresh: load, retry: () => void load(), applyDeposit }),
    [state, load, applyDeposit],
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
