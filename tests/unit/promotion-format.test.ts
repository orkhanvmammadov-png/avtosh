import { describe, expect, it } from "vitest";
import { formatDateAz, formatPriceMinor } from "@/lib/format";

describe("formatDateAz — DD.MM.YYYY in Asia/Baku", () => {
  it("formats promotion end dates in Baku local time", () => {
    // 20:30 UTC = 00:30 next day in Baku (UTC+4)
    expect(formatDateAz("2026-09-13T20:30:00.000Z")).toBe("14.09.2026");
    expect(formatDateAz("2026-01-05T10:00:00.000Z")).toBe("05.01.2026");
    expect(formatDateAz(new Date("2026-12-31T21:00:00.000Z"))).toBe("01.01.2027");
  });
});

describe("package price display reuses the exact minor-unit formatter", () => {
  // the full O.14 matrix: fractional prices render with a comma
  // decimal, whole prices stay whole — no floats, no second formatter
  it.each([
    [300, "3 AZN"],
    [1199, "11,99 AZN"],
    [2199, "21,99 AZN"],
    [3099, "30,99 AZN"],
    [400, "4 AZN"],
    [800, "8 AZN"],
    [1100, "11 AZN"],
    [1300, "13 AZN"],
    // retired legacy placeholder prices remain displayable in Admin
    [700, "7 AZN"],
    [1200, "12 AZN"],
    [200, "2 AZN"],
  ])("%s minor → %s", (minor, expected) => {
    expect(formatPriceMinor(minor, "AZN")).toBe(expected);
  });
});
