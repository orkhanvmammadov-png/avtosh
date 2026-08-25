import { describe, expect, it } from "vitest";
import { aznInputToMinor, formatFreshness, formatMileage, formatPriceMinor, minorToAznInput, vehicleTitle } from "@/lib/format";

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
  it("formats freshness relative to now", () => {
    const now = new Date("2026-08-21T12:00:00Z");
    expect(formatFreshness("2026-08-21T08:00:00Z", now)).toBe("bugün");
    expect(formatFreshness("2026-08-20T08:00:00Z", now)).toBe("dünən");
    expect(formatFreshness("2026-08-15T08:00:00Z", now)).toBe("6 gün əvvəl");
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
