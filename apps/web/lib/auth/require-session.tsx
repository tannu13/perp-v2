"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SIGN_IN_PATH, useSession } from "./session-provider";
import { SkeletonRegion } from "@/components/ui";

/**
 * Gates a route on a signed-in session.
 *
 * This replaces the middleware guard, which cannot work any more: the session
 * cookie is host-only on the API's domain, so nothing running on this app's
 * origin — middleware or Server Component — can see it. See `middleware.ts`.
 *
 * Renders a skeleton rather than null while the session probe is in flight, so
 * a slow answer looks like loading rather than a blank page. It renders no
 * account data at any point: there is none until `GET /me` succeeds.
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
