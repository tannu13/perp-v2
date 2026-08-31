import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import {
  AccountFeedStatus,
  accountFeedVocabulary,
} from "./account-feed-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { UserFeedStatus } from "@/lib/user-feed";

/**
 * D17's indicator.
 *
 * Since Phase 13 there is no refetch behind any account surface, so when the
 * private channel is down the Positions, Open-orders and Balances tables are
 * whatever the last snapshot said — correct at the time, not current, and
 * with nothing on screen admitting it. This is what admits it, and the
 * assertions below are about the two ways it could fail quietly: a state with
 * no word at all, and a word that says the same thing for "live" and for
 * "dropped".
 */

const ALL: UserFeedStatus[] = [
  "idle",
  "connecting",
  "syncing",
  "live",
  "reconnecting",
  "disconnected",
];

describe("the vocabulary", () => {
  it("has a word for every state the channel can be in", () => {
    for (const status of ALL) {
      const v = accountFeedVocabulary(status);
      // `idle` is the one deliberate null: it is what the hook returns where
      // there is no provider at all, and reporting on a channel that is not
      // supposed to exist would be worse than saying nothing.
      if (status === "idle") {
        expect(v).toBeNull();
        continue;
      }
      expect(v?.word.length).toBeGreaterThan(0);
      expect(v?.hint.length).toBeGreaterThan(0);
    }
  });

  it("never gives two states the same word", () => {
    const words = ALL.map((s) => accountFeedVocabulary(s)?.word).filter(Boolean);
    expect(new Set(words).size).toBe(words.length);
  });

  it("only calls the channel online when it actually is", () => {
    expect(accountFeedVocabulary("live")?.intent).toBe("online");
    for (const status of ["connecting", "syncing", "reconnecting", "disconnected"] as const) {
      expect(accountFeedVocabulary(status)?.intent).not.toBe("online");
    }
  });

  /**
   * The whole point of the indicator: the two states in which the tables are
   * frozen have to SAY that the tables are frozen. A dot that changes colour
   * and a hint that does not change wording would pass every other assertion
   * here and tell the user nothing.
   */
  it("says the numbers are frozen in both states where they are", () => {
    expect(accountFeedVocabulary("reconnecting")?.hint).toMatch(/frozen/i);
    expect(accountFeedVocabulary("disconnected")?.hint).toMatch(/frozen/i);
    expect(accountFeedVocabulary("live")?.hint).not.toMatch(/frozen/i);
  });
});

describe("the indicator", () => {
  it("renders nothing where there is no channel", () => {
    // No `UserFeedProvider` above it — the landing page and the design-system
    // pages mount none, and `useUserFeedStatus` answers `idle` there.
    const { container } = render(
      <TooltipProvider>
        <AccountFeedStatus />
      </TooltipProvider>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("the dot's accessible text", () => {
  it("is a sentence, not the colour and not the word alone", () => {
    // A bare coloured dot conveys nothing to a screen reader, and "warning"
    // conveys almost as little; the `StatusDot` label is the hint, so the hint
    // has to stand on its own.
    for (const status of ALL) {
      const v = accountFeedVocabulary(status);
      if (!v) continue;
      expect(v.hint).not.toBe(v.word);
      expect(v.hint.split(" ").length).toBeGreaterThan(4);
    }
  });
});
