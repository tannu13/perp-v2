import { describe, expect, it } from "bun:test";
import { addMoney } from "./money";

describe("addMoney", () => {
  it("adds without float drift", () => {
    // The reason this module exists: 0.1 + 0.2 === 0.30000000000000004.
    expect(addMoney("0.1", "0.2")).toBe("0.3");
  });

  it("adds a real balance pair", () => {
    expect(addMoney("1958.10", "562.90")).toBe("2521.00");
  });

  it("preserves the widest scale", () => {
    expect(addMoney("1.5", "2.25")).toBe("3.75");
    expect(addMoney("1", "2")).toBe("3");
  });

  it("keeps trailing zeros that were significant", () => {
    // "2521.00" and "2521" mean the same number but not the same precision.
    expect(addMoney("1958.10", "562.90")).toBe("2521.00");
  });

  it("handles very large values a float would round", () => {
    expect(addMoney("9007199254740993", "1")).toBe("9007199254740994");
  });

  it("handles negatives", () => {
    expect(addMoney("10.00", "-2.50")).toBe("7.50");
    expect(addMoney("-1.5", "-2.5")).toBe("-4.0");
  });

  it("returns null rather than a wrong total for junk", () => {
    for (const bad of ["", "abc", "1.2.3", "NaN", "1e5"]) {
      expect(addMoney("1.00", bad)).toBeNull();
    }
  });
});
