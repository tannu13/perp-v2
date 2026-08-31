"use client";

import { cn } from "@/lib/cn";
import { useUserFeedStatus, type UserFeedStatus } from "@/lib/user-feed";
import { StatusDot, Tooltip } from "@/components/ui";

/**
 * Whether the account's own numbers are live.
 *
 * The market bar has had a status dot since Phase 11 and the private channel
 * has had none since Phase 13, which is D17: with ws-server down, an order
 * placed after page load never appears in Open orders, a position never
 * appears in Positions, and buying power never moves. Every one of those
 * tables is showing the snapshot it was given — it is not lying about
 * anything, but it is not current, and the refetches that used to paper over
 * it were deliberately deleted when the channel replaced them. Phase 14's
 * acceptance criterion is that no surface can show data with no visible
 * indication that the data is stale. This is that indication.
 *
 * It is one dot for the whole account rather than a badge per table because
 * the three providers share one socket: when it is down they are all equally
 * stale, and three identical warnings would be three times the noise for one
 * fact.
 *
 * `syncing` gets its own word rather than being folded into `live`. It was
 * kept separate in Phase 13 precisely so this phase could decide, and the
 * decision is that it is worth saying: during it the tables hold state that is
 * about to be replaced, and an event that has already arrived has not been
 * applied yet. It is brief, and it is the only honest label for that moment.
 */
type Vocabulary = {
  word: string;
  intent: "online" | "offline" | "warning" | "info";
  pulse: boolean;
  hint: string;
};

export function accountFeedVocabulary(status: UserFeedStatus): Vocabulary | null {
  switch (status) {
    /**
     * Nothing to say. `idle` is what the hook returns where there is no
     * provider at all — the design-system pages mount none — and where nobody
     * is signed in. A dot there would be reporting on a channel that is not
     * supposed to exist.
     */
    case "idle":
      return null;
    case "connecting":
      return {
        word: "connecting",
        intent: "info",
        pulse: true,
        hint: "Opening the private channel that carries your fills, orders and balances.",
      };
    case "syncing":
      return {
        word: "syncing",
        intent: "info",
        pulse: true,
        hint: "Connected. Re-reading your orders, positions and balances before applying anything that arrived while the channel was down.",
      };
    case "live":
      return {
        word: "live",
        intent: "online",
        pulse: true,
        hint: "Your fills, orders, positions and balances are pushed as they happen.",
      };
    case "reconnecting":
      return {
        word: "reconnecting",
        intent: "warning",
        pulse: true,
        hint: "The private channel dropped and is being reopened. Your orders, positions and balances are frozen at the last update — anything that happens now will appear when it reconnects.",
      };
    case "disconnected":
      return {
        word: "offline",
        intent: "offline",
        pulse: false,
        hint: "The private channel is closed. Your orders, positions and balances are frozen at the last update — nothing here is estimated.",
      };
  }
}

export function AccountFeedStatus({ className }: { className?: string }) {
  const status = useUserFeedStatus();
  const vocabulary = accountFeedVocabulary(status);
  if (!vocabulary) return null;

  return (
    <Tooltip content={vocabulary.hint}>
      <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
        <StatusDot
          intent={vocabulary.intent}
          size="sm"
          pulse={vocabulary.pulse}
          /* The dot's own accessible text carries the whole sentence: a colour
             conveys nothing, and "warning" would convey almost as little. */
          label={`Account feed: ${vocabulary.hint}`}
        />
        {/* The word is the sighted reader's half of the same fact, and it is
            hidden on a phone rather than dropped — the header is a fixed 56px
            row and must never grow. The dot and its tooltip survive at every
            width. */}
        <span className="hidden text-micro whitespace-nowrap text-text-tertiary md:inline">
          {vocabulary.word}
        </span>
      </div>
    </Tooltip>
  );
}
