import { describe, expect, it } from "vitest";
import { aznInputToMinor, formatDateAz, formatFreshness, formatTimeAz, formatMileage, formatPriceMinor, minorToAznInput, vehicleTitle } from "@/lib/format";

describe("formatPriceMinor", () => {
  it("formats whole AZN with thin-space grouping from minor units", () => {
    expect(formatPriceMinor(200000)).toBe("2 000 AZN");
    expect(formatPriceMinor(1550000)).toBe("15 500 AZN");
    expect(formatPriceMinor(99)).toBe("0,99 AZN");
    expect(formatPriceMinor(150050)).toBe("1 500,50 AZN");
    expect(formatPriceMinor(9_000_000_000_000)).toBe("90 000 000 000 AZN");
  });
  it("never uses float math and handles null", () => {
    expect(formatPriceMinor(null)).toBe("Qiymət göstərilməyib");
    expect(formatPriceMinor(0.1 as number)).toBe("Qiymət göstərilməyib");
  });
});

describe("other formatters", () => {
  it("formats mileage and titles", () => {
    expect(formatMileage(125000)).toBe("125 000 km");
    expect(formatMileage(null)).toBe("—");
    expect(vehicleTitle({ brand: "Toyota", model: "Corolla", year: 2020 })).toBe("Toyota Corolla 2020");
    expect(vehicleTitle({ brand: null, model: null, year: null })).toBe("Elan");
  });
  it("formats freshness relative to an explicit reference", () => {
    const now = Date.parse("2026-08-21T12:00:00Z");
    expect(formatFreshness("2026-08-21T08:00:00Z", now)).toBe("bugün");
    expect(formatFreshness("2026-08-20T08:00:00Z", now)).toBe("dünən");
    expect(formatFreshness("2026-08-15T08:00:00Z", now)).toBe("6 gün əvvəl");
  });
});

describe("date determinism (hydration contract)", () => {
  // The absolute freshness branch and formatDateAz must produce the
  // accepted Azerbaijani DD.MM.YYYY (Asia/Baku) on EVERY runtime.
  // Regression for the CI hydration failure: Node's ICU formatted
  // toLocaleDateString("az-AZ") as "22.07.2026" while Chromium's az
  // data produced the root pattern "2026-07-22" — the parts-assembled
  // formatter is runtime-independent.
  const ref = Date.parse("2026-08-31T12:00:00Z");

  it("renders old listings as DD.MM.YYYY in Asia/Baku", () => {
    expect(formatFreshness("2026-07-22T10:00:00Z", ref)).toBe("22.07.2026");
    expect(formatDateAz("2026-07-22T10:00:00Z")).toBe("22.07.2026");
  });

  it("uses the Baku calendar day for UTC timestamps near midnight", () => {
    // 20:30 UTC = 00:30 next day in Baku (UTC+4)
    expect(formatDateAz("2026-07-21T20:30:00Z")).toBe("22.07.2026");
    // 19:30 UTC is still 23:30 the same Baku day
    expect(formatDateAz("2026-07-21T19:30:00Z")).toBe("21.07.2026");
  });

  it("pads day/month and crosses year boundaries in Baku time", () => {
    expect(formatDateAz("2026-01-05T10:00:00Z")).toBe("05.01.2026");
    // 21:00 UTC Dec 31 = 01:00 Jan 1 in Baku
    expect(formatDateAz("2025-12-31T21:00:00Z")).toBe("01.01.2026");
    expect(formatDateAz("2025-12-31T18:00:00Z")).toBe("31.12.2025");
  });

  it("formats claim times as HH:MM in Baku with a fixed 24h cycle", () => {
    expect(formatTimeAz("2026-07-22T10:35:00Z")).toBe("14:35");
    expect(formatTimeAz("2026-07-22T20:05:00Z")).toBe("00:05"); // next Baku day, zero-padded
  });

  it("the relative window is driven ONLY by the supplied reference", () => {
    const published = "2026-08-01T12:00:00Z";
    expect(formatFreshness(published, Date.parse("2026-08-30T12:00:00Z"))).toBe("29 gün əvvəl");
    expect(formatFreshness(published, Date.parse("2026-08-31T12:00:00Z"))).toBe("01.08.2026");
  });
});

describe("AZN input conversion", () => {
  it("converts whole AZN to minor units and back without floats", () => {
    expect(aznInputToMinor("20000")).toBe("2000000");
    expect(aznInputToMinor(" 1 ")).toBe("100");
    expect(aznInputToMinor("12.5")).toBeNull();
    expect(aznInputToMinor("-3")).toBeNull();
    expect(aznInputToMinor("")).toBeNull();
    expect(minorToAznInput("2000000")).toBe("20000");
    expect(minorToAznInput("50")).toBe("0");
    expect(minorToAznInput(undefined)).toBe("");
  });
});
