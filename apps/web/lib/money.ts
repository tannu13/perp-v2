/**
 * Arithmetic on money strings.
 *
 * The backend sends prices, sizes and balances as strings specifically so they
 * never pass through a float (see the money rule in CLAUDE.md), and adding two
 * of them for a display total should not quietly undo that: `0.1 + 0.2` is
 * `0.30000000000000004`, and a balance is exactly the place that shows up.
 *
 * These work on the decimal strings directly, in integer arithmetic scaled to
 * the widest number of decimal places involved. Deliberately small: this is a
 * display aggregation helper, not a decimal library. If the system ever needs
 * multiplication or division on money, reach for a real one.
 */

type Parsed = { negative: boolean; digits: string; scale: number };

function parse(value: string): Parsed | null {
  const trimmed = value.trim();
  if (!/^-?\d*(\.\d+)?$/.test(trimmed) || trimmed === "" || trimmed === "-") {
    return null;
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return {
    negative,
    digits: `${whole}${fraction}`,
    scale: fraction.length,
  };
}

function toScaled(parsed: Parsed, scale: number): bigint {
  const padded = parsed.digits + "0".repeat(scale - parsed.scale);
  const magnitude = BigInt(padded === "" ? "0" : padded);
  return parsed.negative ? -magnitude : magnitude;
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? digits.slice(digits.length - scale) : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Adds money strings without going through a float.
 *
 * Returns null if any input is not a decimal number — an unparseable balance is
 * a real condition (a schema drift, a missing field) and the caller should show
 * an em dash rather than a confidently wrong total.
 */
export function addMoney(...values: string[]): string | null {
  const parsed = values.map(parse);
  if (parsed.some((p) => p === null)) return null;

  const scale = Math.max(...(parsed as Parsed[]).map((p) => p.scale), 0);
  const total = (parsed as Parsed[]).reduce(
    (sum, p) => sum + toScaled(p, scale),
    0n,
  );
  return fromScaled(total, scale);
}
