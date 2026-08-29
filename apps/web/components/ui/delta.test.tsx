import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Delta, Side } from "./delta";

/**
 * A harness check as much as a component check.
 *
 * What it asserts is a rule from CLAUDE.md that no amount of token work can
 * enforce: direction must never be carried by colour alone, because roughly 8%
 * of men cannot separate the red/green pair. `Delta` always prints a sign and
 * `Side` always prints a word — if either stops doing so, this fails.
 */
describe("directional affordances", () => {
  it("prints an explicit sign on a positive delta", () => {
    render(<Delta value={412.38} unit="USD" />);
    expect(screen.getByText(/\+/)).toBeInTheDocument();
  });

  it("prints an explicit sign on a negative delta", () => {
    render(<Delta value={-412.38} unit="USD" />);
    // The formatter uses a true minus sign (U+2212), not a hyphen.
    expect(screen.getByText(/[−-]/)).toBeInTheDocument();
  });

  it("prints the word LONG, not just a colour", () => {
    render(<Side side="LONG" />);
    expect(screen.getByText(/long/i)).toBeInTheDocument();
  });

  it("prints the word SHORT, not just a colour", () => {
    render(<Side side="SHORT" />);
    expect(screen.getByText(/short/i)).toBeInTheDocument();
  });
});
