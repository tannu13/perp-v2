"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/lib/auth/session-provider";
import { useToast } from "@/components/ui/toast";

/**
 * One toast per expired session. Renders nothing else.
 *
 * §6.15 asks for exactly one toast and one redirect when a session ends
 * mid-use. The redirect already existed — it is the interceptor in
 * `SessionProvider`, and it carries `next=` so the user comes back to the
 * screen they were on. What was missing was the sentence: the terminal simply
 * became the sign-in page, with no statement of why, which reads as the app
 * losing the user's place rather than as their session ending.
 *
 * It is a separate component because of where the two providers sit.
 * `SessionProvider` is the OUTERMOST provider in the root layout — the 401
 * interceptor it installs has to outlive every provider that can trigger one —
 * so it is above `ToastProvider` and cannot call `useToast` itself. It exposes
 * a counter instead; this watches it.
 *
 * A counter, not a boolean, and the ref is what makes it one toast: React may
 * render this component any number of times for one increment, and the toast
 * fires only when the number it last announced changes.
 *
 * Nothing here fires for a deliberate sign-out. That path never goes through
 * the interceptor — the user asked, and telling them what they just did is
 * noise.
 */
export function SessionNotice() {
  const { expiredCount } = useSession();
  const { toast } = useToast();
  const announced = useRef(expiredCount);

  useEffect(() => {
    if (expiredCount === announced.current) return;
    announced.current = expiredCount;

    toast({
      // `warning`, not `danger`: an expired session is the system working as
      // designed, and nothing the user did failed. Danger is reserved for a
      // request that was refused.
      intent: "warning",
      title: "Session expired",
      description:
        "Sign in again to continue — you'll come back to where you were.",
    });
  }, [expiredCount, toast]);

  return null;
}
