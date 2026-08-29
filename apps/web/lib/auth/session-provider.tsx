"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { setAuthFailureHandler } from "@/lib/api/http";
import { me, signin, signout, signup } from "@/lib/api/endpoints";

/**
 * The session.
 *
 * The ONLY place identity lives. No component reads a cookie, and no component
 * can read the token at all — the backend sets it httpOnly on its own host and
 * it never crosses into JavaScript. What is exposed here is a name and an id.
 *
 * Identity is ASKED FOR, not decoded: `GET /me` is the boot probe, because a
 * client cannot inspect a cookie it is not allowed to read.
 *
 * IMPORTANT: `app/layout.tsx` must import this by path, never through the
 * `@/components/ui` barrel. That barrel has no `"use client"`, so reaching a
 * client module through it from a Server Component can produce two copies of
 * the same React context — the provider sets one and consumers read the other.
 * The layout file explains this at length; the same rule applies here.
 */

export type SessionStatus = "loading" | "authed" | "anon";

export type SessionIdentity = { userId: string; username: string };

export type SessionValue = {
  status: SessionStatus;
  /**
   * True while an explicit sign-out is navigating away.
   *
   * `RequireSession` needs this: signing out from `/trade/*` flips the status to
   * "anon", and without knowing why, the guard would race the sign-out's own
   * "go home" with a "you are not signed in, go to /signin". Same event, two
   * different right answers — the distinction is whether the user asked.
   */
  signingOut: boolean;
  /** Null unless `status === "authed"`. */
  identity: SessionIdentity | null;
  signIn: (input: { username: string; password: string }) => Promise<void>;
  signUp: (input: {
    username: string;
    password: string;
    name: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return value;
}

/** Where an expired session sends you, with a way back to where you were. */
export const SIGN_IN_PATH = "/signin";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  /**
   * Starts as "loading" on the server and on the first client render, so the
   * two trees match and there is no hydration mismatch. Resolution happens only
   * in the effect below.
   */
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [identity, setIdentity] = useState<SessionIdentity | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Read inside callbacks that must not re-subscribe when the status changes.
  const statusRef = useRef(status);
  statusRef.current = status;

  // Restore across a reload. The cookie survives; React state does not.
  useEffect(() => {
    let cancelled = false;

    me()
      .then((identity: SessionIdentity) => {
        if (cancelled) return;
        setIdentity(identity);
        setStatus("authed");
      })
      .catch(() => {
        if (cancelled) return;
        // A 401 here is the ordinary "not signed in" answer, and an unreachable
        // API is not the same thing — but there is nothing to trade with in
        // either case. Treat both as anonymous and let the first real request
        // surface the actual failure.
        setIdentity(null);
        setStatus("anon");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const clearLocally = useCallback(() => {
    setIdentity(null);
    setStatus("anon");
  }, []);

  const signIn = useCallback(
    async (input: { username: string; password: string }) => {
      const next = await signin(input);
      setSigningOut(false);
      setIdentity(next);
      setStatus("authed");
      // Server Components hold the previous session's data in the router cache.
      router.refresh();
    },
    [router],
  );

  const signUp = useCallback(
    async (input: { username: string; password: string; name: string }) => {
      const next = await signup(input);
      setSigningOut(false);
      setIdentity(next);
      setStatus("authed");
      router.refresh();
    },
    [router],
  );

  const signOut = useCallback(async () => {
    setSigningOut(true);
    // Clear locally first: if the network call fails, the tab must still stop
    // behaving as though someone is signed in.
    clearLocally();
    await signout().catch(() => undefined);

    /**
     * Leave the account surface.
     *
     * Signing out while standing on `/trade/*` used to leave the user on a page
     * they can no longer load — the chrome went anonymous but the route stayed,
     * so the next navigation or refresh bounced them to the sign-in screen out
     * of nowhere. Going home is also why this awaits the request first: the
     * cookie must actually be gone before the guard evaluates it.
     */
    router.replace("/");
    router.refresh();
  }, [clearLocally, router]);

  /**
   * The single 401 interceptor.
   *
   * `http.ts` collapses a burst of concurrent failures into one call, so a
   * screen with five tables refetching produces one redirect. The extra guard
   * here covers the other direction: a 401 arriving when we already believe we
   * are anonymous must not bounce someone off the sign-in page they are already
   * looking at, which is how redirect loops start.
   */
  useEffect(() => {
    setAuthFailureHandler(() => {
      if (statusRef.current === "anon") return;
      clearLocally();

      const here = `${window.location.pathname}${window.location.search}`;
      const target = here.startsWith(SIGN_IN_PATH)
        ? SIGN_IN_PATH
        : `${SIGN_IN_PATH}?next=${encodeURIComponent(here)}`;
      router.replace(target);
    });

    return () => setAuthFailureHandler(null);
  }, [clearLocally, router]);

  const value = useMemo<SessionValue>(
    () => ({ status, identity, signingOut, signIn, signUp, signOut }),
    [status, identity, signingOut, signIn, signUp, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
