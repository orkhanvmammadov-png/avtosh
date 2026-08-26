import { describe, expect, it } from "vitest";
import { majorToMinorExact, minorToMajorString } from "@/lib/payments/money";

describe("minor → major decimal string (provider order amounts)", () => {
  it.each([
    [200, "2.00"],
    [250, "2.50"],
    [1, "0.01"],
    [0, "0.00"],
    [199, "1.99"],
    [123456789, "1234567.89"],
  ])("%s minor → %s", (minor, expected) => {
    expect(minorToMajorString(minor)).toBe(expected);
  });

  it("rejects non-integers and negatives", () => {
    expect(() => minorToMajorString(2.5)).toThrow();
    expect(() => minorToMajorString(-1)).toThrow();
    expect(() => minorToMajorString(Number.NaN)).toThrow();
  });
});

describe("provider decimal → minor units (verification comparison)", () => {
  it.each([
    ["2", 200],
    ["2.5", 250],
    ["2.50", 250],
    ["0.01", 1],
    [2, 200],
    [2.5, 250],
    ["1234567.89", 123456789],
  ])("%j → %s", (value, expected) => {
    expect(majorToMinorExact(value)).toBe(expected);
  });

  it.each(["2.505", "-1", "abc", "", "1e3", "2,00", null, undefined, {}, "2.", ".5"])(
    "rejects %j (a rejected amount can never match)",
    (value) => {
      expect(majorToMinorExact(value)).toBeNull();
    },
  );
});
