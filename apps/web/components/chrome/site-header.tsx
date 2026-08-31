"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/format";
import { useAccount } from "@/lib/account";
import { useSession } from "@/lib/auth/session-provider";
import { usePositionsOptional } from "@/lib/positions";
import { DEFAULT_MARKET } from "@/lib/markets";
import {
  Button,
  buttonVariants,
  Delta,
  IconButton,
  LogoMark,
  RefreshIcon,
  Skeleton,
  SkeletonRegion,
  Tooltip,
} from "@/components/ui";
import { DepositDialog } from "@/components/terminal/deposit-dialog";
import { AccountFeedStatus } from "./account-feed-status";
import { AccountMenu } from "./account-menu";

/**
 * The global header.
 *
 * Deposit and the account menu live here now. They were in the market bar
 * because that was the only top chrome in the app, which put an account-level
 * action inside a market-level surface — the wrong home for something that has
 * nothing to do with SOL-USD.
 *
 * IMPORTANT for the terminal: this is a fixed-height, non-shrinking row inside
 * the `h-dvh` shell. It must never be given `min-h` or allowed to grow, because
 * the whole desktop layout is "the window, exactly" and anything that adds
 * height here pushes the panel row into a page scrollbar. `shrink-0` plus a
 * hard `h-(--size-header)` is the contract.
 */

const NAV = [
  { href: `/trade/${DEFAULT_MARKET.slug}`, label: "Trade" },
  { href: "/design-system", label: "Design system" },
  { href: "/design-system/components", label: "Components" },
];

export function SiteHeader({ className }: { className?: string }) {
  const account = useAccount();
  const session = useSession();
  const pathname = usePathname();
  const [depositOpen, setDepositOpen] = useState(false);

  return (
    <header
      className={cn(
        "flex h-(--size-header) shrink-0 items-center gap-3 px-3",
        "border-b border-border-subtle bg-surface-raised",
        className,
      )}
    >
      <Link
        href="/"
        className={cn(
          "flex shrink-0 items-center gap-2 rounded-md px-1 py-1",
          "focus-visible:outline-none focus-visible:shadow-focus",
        )}
      >
        <LogoMark className="size-5" />
        <span className="text-body-md font-semibold tracking-tight text-text-primary">
          Perp
        </span>
      </Link>

      {/* Nav collapses below md — on a phone the account menu carries these. */}
      <nav className="hidden items-center gap-0.5 md:flex" aria-label="Main">
        {NAV.map((item) => {
          const active =
            item.href === "/design-system"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-body-sm",
                "transition-colors duration-fast",
                "focus-visible:outline-none focus-visible:shadow-focus",
                active
                  ? "bg-surface-active text-text-primary"
                  : "text-text-tertiary hover:bg-surface-hover hover:text-text-secondary",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        {/*
          Three states, and the middle one matters: while the session is still
          resolving we show nothing rather than flashing "Sign in" at someone who
          is already signed in. The header is a fixed 56px row either way, so
          nothing reflows when it settles.
        */}
        {session.status === "loading" ? null : session.status === "anon" ? (
          <>
            {/* Links, not buttons: these navigate. `buttonVariants` gives them
                the button's appearance and its six states without turning an
                anchor into a click handler. */}
            <Link
              href="/signin"
              className={cn(buttonVariants({ intent: "neutral", size: "sm" }))}
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className={cn(buttonVariants({ intent: "primary", size: "sm" }))}
            >
              Create account
            </Link>
          </>
        ) : (
          <>
            {/*
              Before the equity figure, not after it, and that is the point:
              this dot says whether the number to its right is being kept up to
              date. Since Phase 13 there is no refetch behind any account
              surface — if the private channel is down, equity, positions and
              open orders are all the last snapshot the server gave, and D17
              records that nothing on screen used to admit it.
            */}
            <AccountFeedStatus />

            <EquityReadout account={account} />

            <Button
              intent="primary"
              size="sm"
              onClick={() => setDepositOpen(true)}
              // Account-level, not market-level. `primary` because adding
              // collateral has no direction — green would read as a long.
            >
              Deposit
            </Button>

            <AccountMenu
              account={account}
              onDeposit={() => setDepositOpen(true)}
            />
          </>
        )}
      </div>

      <DepositDialog open={depositOpen} onOpenChange={setDepositOpen} />
    </header>
  );
}

/**
 * Equity and unrealised PnL.
 *
 * Hidden below `sm`: on a phone this competes with the last price in the market
 * bar, and equity is not what someone checks mid-trade on a 375px screen. It is
 * still one tap away in the account menu.
 *
 * The skeleton is sized to the widest realistic figure rather than the current
 * one, so the number does not shift sideways when it lands.
 *
 * **Equity here is collateral — `available + locked` — and the Delta beside it
 * is unrealised PnL.** They are deliberately two figures rather than one sum.
 * Folding PnL into equity would make the header disagree with the Balances tab,
 * which shows the same `equity` as the total of a USD collateral row, and a
 * collateral row is not the place for a mark-to-market adjustment.
 */
function EquityReadout({
  account,
}: {
  account: ReturnType<typeof useAccount>;
}) {
  /**
   * Optional, because this header renders on the landing page and the
   * design-system pages, and only the terminal mounts `PositionsProvider` —
   * fanning three position requests out of a marketing page to fill in one
   * figure would be absurd. Off the terminal the Delta is an em dash, which
   * says "not known here" rather than "zero".
   */
  const positions = usePositionsOptional();
  if (account.status === "loading") {
    return (
      <SkeletonRegion
        label="Loading equity"
        className="hidden flex-col items-end gap-1 sm:flex"
      >
        <Skeleton shape="text" className="h-2 w-10" />
        <Skeleton shape="text" className="h-3 w-20" />
      </SkeletonRegion>
    );
  }

  if (account.status === "error") {
    // Inline, not an ErrorState: the header has 56px and a failed balance read
    // must not push the layout around. The full explanation and the retry live
    // in the account menu, which has room for them.
    return (
      <Tooltip content={`Balances unavailable — ${account.error}`}>
        <span className="hidden items-center gap-1 sm:flex">
          <span className="text-caption text-text-tertiary">Equity —</span>
          <IconButton
            label="Retry loading balances"
            size="sm"
            onClick={account.retry}
          >
            <RefreshIcon />
          </IconButton>
        </span>
      </Tooltip>
    );
  }

  return (
    <div className="hidden flex-col items-end leading-tight sm:flex">
      <span className="text-micro uppercase text-text-tertiary">Equity</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-num-sm tnum font-semibold text-text-primary">
          {formatUsd(account.data.equity)}
        </span>
        {/* Delta always prints a sign, so PnL direction survives without hue.
            Null whenever the total is not knowable — no provider here, the
            positions request still in flight or failed, or a position whose
            book has no two-sided mid. An em dash, never a zero, which would be
            a lie about money. */}
        {positions?.totalUnrealisedPnl == null ? (
          <span className="text-num-sm text-text-tertiary">—</span>
        ) : (
          <Delta value={positions.totalUnrealisedPnl} size="sm" />
        )}
      </span>
    </div>
  );
}
