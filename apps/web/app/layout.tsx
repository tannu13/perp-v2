import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
/**
 * Imported from their own modules, NOT from the `@/components/ui` barrel.
 *
 * This layout is a Server Component, and the barrel has no `"use client"` —
 * so reaching a client module through it makes the module a client *reference*
 * created on the server, while the client components that import the same
 * barrel pull the module into the browser graph directly. The two do not
 * always unify, and when they do not you get two instances of the same React
 * context: the provider sets one, `useToast` reads the other, and every
 * consumer throws "must be used inside <ToastProvider>" with the provider
 * plainly right there in the tree.
 *
 * Rule: a context provider crossing the server/client boundary is imported by
 * path.
 */
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/lib/auth/session-provider";
import { UserFeedProvider } from "@/lib/user-feed";
import { AccountProvider } from "@/lib/account";
import { FillNotifications } from "@/components/chrome/fill-notifications";
import { SessionNotice } from "@/components/chrome/session-notice";
import "./globals.css";

/**
 * A true superfamily, chosen for one structural reason: in this UI mono and
 * sans sit adjacent inside the same table row — an order id beside a price.
 * Plex Sans and Plex Mono share a skeleton, x-height and weight axis, so those
 * columns align optically. An unrelated pairing does not.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Perp — Perpetual Futures Exchange",
  description:
    "Event-driven perpetual futures trading with sub-millisecond matching.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        {/* Shared tooltip timing — hovering between adjacent tooltips should
            not restart the open delay each time. */}
        {/* Outermost: the 401 interceptor it installs has to outlive anything
            that can trigger one, and a toast about an expired session is
            rendered by a provider inside it. */}
        <SessionProvider>
          {/* The private user channel. Above every provider that reads from it
              and below the session, because it needs a user id to open a
              socket at all and it re-opens when that changes.

              App-wide, not terminal-scoped: balances are shown in the header on
              every page, and a fill can land while the user is anywhere. */}
          <UserFeedProvider>
            {/* Inside the session: it only fetches for a signed-in user, and it
                reads `useSession` to know. */}
            <AccountProvider>
              <TooltipProvider delayDuration={200} skipDelayDuration={400}>
                {/* Toasts mount at the root because a fill can land while the user is
                  anywhere — including inside a dialog. The viewport is portalled
                  above every other layer for the same reason. */}
                <ToastProvider>
                  {/* Renders nothing. Announces the fills that have no request
                      behind them — a maker being hit, and a liquidation. */}
                  <FillNotifications />
                  {/* Also renders nothing. One toast per expired session — the
                      sentence that goes with the interceptor's redirect, which
                      `SessionProvider` cannot raise itself because it is above
                      this toast provider. */}
                  <SessionNotice />
                  {children}
                </ToastProvider>
              </TooltipProvider>
            </AccountProvider>
          </UserFeedProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
