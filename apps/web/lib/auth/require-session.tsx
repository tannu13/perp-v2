"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SIGN_IN_PATH, useSession } from "./session-provider";
import { SkeletonRegion } from "@/components/ui";

/**
 * Gates a route on a signed-in session.
 *
 * This is where route protection lives, and the only place it can. The session
 * cookie belongs to the API host (`api.example.com`), not to this app's origin
 * — that is what makes it host-only and immune to a sibling subdomain. The
 * consequence is that neither middleware nor a Server Component could see it:
 * they run on a different host and the browser never sends it there. Under
 * `output: export` there is no server to run them on at all, but the guard was
 * already client-side before that, for this reason rather than that one.
 *
 * The trade-off is honest: a protected route paints one loading frame before
 * redirecting, where middleware could have redirected before any HTML was
 * sent. Nothing is exposed by that frame — it renders no account data, because
 * there is none to render until `GET /me` succeeds.
 *
 * The alternative — having the frontend also set a readable "signed in" hint
 * cookie on its own origin purely so a guard could redirect earlier — was
 * rejected: it is a second source of truth about auth state that can disagree
 * with the real one, in exchange for saving one frame.
 *
 * Renders a skeleton rather than null while the session probe is in flight, so
 * a slow answer looks like loading rather than a blank page.
 */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const { status, signingOut, expiredCount } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  /**
   * The expiry count this guard mounted with.
   *
   * An EXPIRED session is the interceptor's redirect to make, not this one's,
   * and Phase 14's criterion is one redirect carrying `next=`. Both fire on the
   * same state change — the interceptor synchronously, then this effect when
   * the status it set reaches render — and the second one wins. The
   * interceptor's target carries `pathname + search`; this one knows only the
   * pathname, so letting it run last silently dropped the query string from
   * the URL the user is sent back to.
   */
  const expiredAtMount = useRef(expiredCount);

  useEffect(() => {
    if (status !== "anon") return;
    // An explicit sign-out is already navigating home; redirecting to /signin
    // as well would race it and land the user somewhere they did not ask for.
    if (signingOut) return;
    // As above: the interceptor has already redirected, with a better URL.
    if (expiredCount !== expiredAtMount.current) return;
    const next = encodeURIComponent(pathname);
    router.replace(`${SIGN_IN_PATH}?next=${next}`);
  }, [status, signingOut, expiredCount, pathname, router]);

  if (status === "authed") return <>{children}</>;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-base p-4">
      <SkeletonRegion
        label={status === "loading" ? "Checking your session" : "Redirecting"}
        className="flex w-full max-w-[380px] flex-col gap-3"
      >
        <div className="h-3 w-24 rounded-sm bg-surface-raised" />
        <div className="h-10 w-full rounded-md bg-surface-raised" />
        <div className="h-10 w-full rounded-md bg-surface-raised" />
      </SkeletonRegion>
    </div>
  );
}
