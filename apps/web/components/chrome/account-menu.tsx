"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatUsd, truncateId } from "@/lib/format";
import { marginSplit, type AccountState } from "@/lib/account";
import { useSession } from "@/lib/auth/session-provider";
import { usePositionsOptional } from "@/lib/positions";
import {
  Avatar,
  ChevronDownIcon,
  CheckIcon,
  CopyIcon,
  Delta,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuMeta,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  LogOutIcon,
  Seam,
  SettingsIcon,
  Skeleton,
  SkeletonRegion,
  UserIcon,
  WalletIcon,
} from "@/components/ui";

/**
 * The account menu.
 *
 * Three states, all of them real: the account fetch is in flight, it failed, or
 * it resolved. The menu is the same width in all three so opening it does not
 * resize under the cursor — a menu that reflows between a skeleton and its
 * content moves the item you were about to click.
 *
 * The margin Seam is here rather than a plain "Available: $x" row because used
 * versus free collateral is exactly the pairing the signature exists for, and
 * repetition is what makes a signature one. `neutral` intent, not directional:
 * margin has no side, and green/red here would imply one.
 */
export function AccountMenu({
  account,
  onDeposit,
}: {
  account: AccountState & { retry: () => void };
  onDeposit: () => void;
}) {
  // Optional for the same reason as the header's: this menu is in the chrome of
  // pages that mount no `PositionsProvider`. See `usePositionsOptional`.
  const positions = usePositionsOptional();
  const { identity, signOut } = useSession();
  const [copied, setCopied] = useState(false);

  /**
   * The user id, in mono.
   *
   * This row used to show a fabricated Solana address. There is no deposit
   * address in this system and `users` has no email — only `username` and
   * `name` (G18). The id is the one real identifier, and an id is exactly what
   * the mono restriction in CLAUDE.md exists for.
   */
  const copyUserId = () => {
    if (!identity) return;
    void navigator.clipboard.writeText(identity.userId);
    setCopied(true);
    // Local, not a toast. A toast for a copy is noise, and the toast column is
    // reserved for fills — things the user needs to see even while looking away.
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={cn(
          "flex items-center gap-1.5 rounded-full p-0.5 pr-1.5",
          "transition-colors duration-fast hover:bg-surface-hover",
          "focus-visible:outline-none focus-visible:shadow-focus",
          "data-[state=open]:bg-surface-active",
        )}
      >
        <Avatar
          name={identity?.username ?? "Account"}
          size="sm"
          intent="accent"
        />
        <ChevronDownIcon className="size-3.5 text-text-tertiary" />
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        {account.status === "loading" && (
          <SkeletonRegion
            label="Loading account"
            className="flex flex-col gap-2 p-2"
          >
            <Skeleton shape="text" className="h-3 w-24" />
            <Skeleton shape="text" className="h-3 w-40" />
            <Skeleton className="mt-1 h-2.5 w-full" />
            <Skeleton shape="text" className="h-3 w-32" />
          </SkeletonRegion>
        )}

        {account.status === "error" && (
          <ErrorState
            size="sm"
            title="Couldn't load account"
            description="Your balances are unavailable. Trading is unaffected."
            detail={account.error}
            onRetry={account.retry}
          />
        )}

        {account.status === "ready" && (
          <>
            <DropdownMenuLabel>Account</DropdownMenuLabel>

            <div className="px-2.5 pb-2">
              <p className="truncate text-body-sm text-text-primary">
                {identity?.username ?? "—"}
              </p>
              <button
                type="button"
                onClick={copyUserId}
                className={cn(
                  "mt-0.5 flex items-center gap-1.5 rounded-sm font-mono text-micro text-text-tertiary",
                  "transition-colors duration-fast hover:text-text-secondary",
                  "focus-visible:outline-none focus-visible:shadow-focus",
                )}
              >
                {/* Mono and slashed-zero: this is an address, one of the three
                    things mono is reserved for. */}
                {identity ? truncateId(identity.userId, 6, 6) : "—"}
                {copied ? (
                  <CheckIcon className="size-3 text-buy-text" />
                ) : (
                  <CopyIcon className="size-3" />
                )}
                <span className="sr-only">
                  {copied ? "User id copied" : "Copy user id"}
                </span>
              </button>
            </div>

            <div className="px-2.5 pb-2.5">
              <Seam
                intent="neutral"
                size="sm"
                left={marginSplit(account.data).used}
                right={marginSplit(account.data).free}
                leftLabel={`Used ${formatUsd(account.data.marginUsed)}`}
                rightLabel={`Free ${formatUsd(account.data.available)}`}
              />
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={onDeposit}>
              <WalletIcon className="size-4" />
              Deposit
              <DropdownMenuMeta>
                {formatUsd(account.data.equity)}
              </DropdownMenuMeta>
            </DropdownMenuItem>

            <DropdownMenuItem asChild>
              <Link href="/trade/SOL-USD">
                <UserIcon className="size-4" />
                Portfolio
                <DropdownMenuMeta>
                  {/* Same source and same rule as the header's Delta: null
                      whenever the total is not knowable — including on the
                      pages that mount no `PositionsProvider` at all. An em
                      dash, never a zero. */}
                  {positions?.totalUnrealisedPnl == null ? (
                    <span className="text-text-tertiary">—</span>
                  ) : (
                    <Delta
                      value={positions.totalUnrealisedPnl}
                      size="sm"
                      unit="USD"
                    />
                  )}
                </DropdownMenuMeta>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem asChild>
              <Link href="/design-system">
                <SettingsIcon className="size-4" />
                Design system
              </Link>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Quiet destructive, matching Button's danger-ghost. Signing out is
                reversible, so it does not confirm and it is not solid red. */}
            <DropdownMenuItem intent="danger" onSelect={() => void signOut()}>
              <LogOutIcon className="size-4" />
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
