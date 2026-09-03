import { describe, expect, it } from "vitest";
import { LISTING_YEAR_MIN, listingYearMax } from "@/lib/config/marketplace";
import { engineCcOptions } from "@/lib/marketplace/engine-options";
import {
  csvFromIds,
  filtersFromSearchParams,
  filtersToQueryString,
  idsFromCsv,
} from "@/lib/marketplace/search-params";

/** Phase 4.17O.2 — advanced search contract foundation. */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("year policy", () => {
  it("is 1900 through the Baku calendar year + 1 (deterministic)", () => {
    expect(LISTING_YEAR_MIN).toBe(1900);
    // pinned reference date: during 2026 the maximum is 2027
    expect(listingYearMax(new Date("2026-06-15T12:00:00Z"))).toBe(2027);
    expect(listingYearMax(new Date("2030-06-15T12:00:00Z"))).toBe(2031);
    // Baku (UTC+4) is already in the new year while UTC is not
    expect(listingYearMax(new Date("2026-12-31T21:00:00Z"))).toBe(2028);
  });
});

describe("engineCcOptions", () => {
  const options = engineCcOptions();
  it("produces the owner-approved 79-value sequence", () => {
    expect(options).toHaveLength(79);
    expect(options[0]).toBe(0);
    expect(options[options.length - 1]).toBe(16_000);
    expect(new Set(options).size).toBe(79); // unique
  });
  it("steps 100 to 6500, then 500 to 10000, then 1000 to 16000", () => {
    expect(options.filter((v) => v <= 6500)).toHaveLength(66);
    expect(options.filter((v) => v > 6500 && v <= 10_000)).toEqual([7000, 7500, 8000, 8500, 9000, 9500, 10_000]);
    expect(options.filter((v) => v > 10_000)).toEqual([11_000, 12_000, 13_000, 14_000, 15_000, 16_000]);
  });
  it("keeps each boundary exactly once", () => {
    expect(options.filter((v) => v === 6500)).toHaveLength(1);
    expect(options.filter((v) => v === 10_000)).toHaveLength(1);
    const i6500 = options.indexOf(6500);
    expect(options.slice(i6500 - 2, i6500 + 3)).toEqual([6300, 6400, 6500, 7000, 7500]);
    const i10k = options.indexOf(10_000);
    expect(options.slice(i10k - 2, i10k + 3)).toEqual([9000, 9500, 10_000, 11_000, 12_000]);
  });
});

describe("multi-value URL contract", () => {
  it("parses canonical plural CSV params", () => {
    const state = filtersFromSearchParams(new URLSearchParams(`category=CAR&fuel_type_ids=${A},${B}`));
    expect(state.fuel_type_ids).toBe(`${A},${B}`);
    expect(state.fuel_type_id).toBeUndefined();
  });
  it("keeps legacy singular URLs working by normalizing into the plural key", () => {
    const state = filtersFromSearchParams(new URLSearchParams(`category=CAR&fuel_type_id=${A}&transmission_id=${B}&color_id=${C}`));
    expect(state.fuel_type_ids).toBe(A);
    expect(state.transmission_ids).toBe(B);
    expect(state.color_ids).toBe(C);
    expect(state.fuel_type_id).toBeUndefined();
    expect(state.transmission_id).toBeUndefined();
    expect(state.color_id).toBeUndefined();
  });
  it("merges singular + plural into one deduplicated collection", () => {
    const state = filtersFromSearchParams(new URLSearchParams(`category=CAR&fuel_type_ids=${A},${B}&fuel_type_id=${A}`));
    expect(idsFromCsv(state.fuel_type_ids)).toEqual([A, B]);
  });
  it("serializes the canonical plural form deterministically", () => {
    const qs = filtersToQueryString({ category: "CAR", fuel_type_ids: `${A},${B}`, color_ids: C });
    expect(qs).toBe(`category=CAR&fuel_type_ids=${encodeURIComponent(`${A},${B}`)}&color_ids=${C}`);
  });
  it("csv helpers dedupe and round-trip", () => {
    expect(idsFromCsv(` ${A}, ${B},${A} `)).toEqual([A, B]);
    expect(csvFromIds([A, B, A])).toBe(`${A},${B}`);
    expect(idsFromCsv(undefined)).toEqual([]);
  });
});

describe("condition params", () => {
  it("keeps only positive true claims", () => {
    const state = filtersFromSearchParams(new URLSearchParams("category=CAR&no_accident=true&not_repainted=false"));
    expect(state.no_accident).toBe("true");
    expect(state.not_repainted).toBeUndefined();
  });
});

describe("legacy year URL canonicalization", () => {
  it("clamps pre-policy years to the accepted boundary", () => {
    const state = filtersFromSearchParams(new URLSearchParams("category=CAR&year_min=1800&year_max=2100"));
    expect(state.year_min).toBe("1900");
    expect(state.year_max).toBe(String(listingYearMax()));
  });
  it("keeps in-range years untouched", () => {
    const state = filtersFromSearchParams(new URLSearchParams("category=CAR&year_min=2020&year_max=2024"));
    expect(state.year_min).toBe("2020");
    expect(state.year_max).toBe("2024");
  });
});
