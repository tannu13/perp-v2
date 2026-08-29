"use client";

import { useEffect } from "react";
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
  const { status, signingOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status !== "anon") return;
    // An explicit sign-out is already navigating home; redirecting to /signin
    // as well would race it and land the user somewhere they did not ask for.
    if (signingOut) return;
    const next = encodeURIComponent(pathname);
    router.replace(`${SIGN_IN_PATH}?next=${next}`);
  }, [status, signingOut, pathname, router]);

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
