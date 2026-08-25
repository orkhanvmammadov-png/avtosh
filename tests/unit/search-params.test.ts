import { describe, expect, it } from "vitest";
import {
  appendUnique,
  boostSlotClass,
  filtersForCategoryChange,
  filtersFromSearchParams,
  filtersToQueryString,
  normalizeSort,
  searchHref,
  visibleFilterGroups,
} from "@/lib/marketplace/search-params";

describe("URL filter model", () => {
  it("parses only known keys and round-trips deterministically", () => {
    const state = filtersFromSearchParams(new URLSearchParams("category=CAR&brand_id=b1&price_max=500&junk=1&sort=PRICE_ASC&empty="));
    expect(state).toEqual({ category: "CAR", brand_id: "b1", price_max: "500", sort: "PRICE_ASC" });
    expect(filtersToQueryString(state)).toBe("category=CAR&brand_id=b1&price_max=500&sort=PRICE_ASC");
    expect(searchHref({ category: "CAR", sort: "NEWEST" })).toBe("/elanlar?category=CAR"); // default sort omitted
    expect(filtersFromSearchParams({ category: ["MOTORCYCLE", "CAR"] })).toEqual({ category: "MOTORCYCLE" });
  });

  it("normalizes sort to the accepted allowlist", () => {
    expect(normalizeSort("PRICE_DESC")).toBe("PRICE_DESC");
    expect(normalizeSort("RANDOM")).toBe("NEWEST");
    expect(normalizeSort(undefined)).toBe("NEWEST");
  });

  it("shows category-specific filter groups only", () => {
    expect(visibleFilterGroups("CAR")).toEqual(["BODY_TYPE", "DRIVE_TYPE", "FUEL_TYPE", "TRANSMISSION", "COLOR"]);
    expect(visibleFilterGroups("MOTORCYCLE")).toEqual(["MOTORCYCLE_TYPE", "FUEL_TYPE", "TRANSMISSION", "COLOR"]);
  });

  it("drops incompatible filters on category change", () => {
    const next = filtersForCategoryChange(
      { category: "CAR", brand_id: "b", model_id: "m", body_type_id: "bt", color_id: "c", feature_ids: "f", price_max: "9" },
      "MOTORCYCLE",
    );
    expect(next).toEqual({ category: "MOTORCYCLE", color_id: "c", price_max: "9" });
  });

  it("maps Boost candidates to 2/3/4 visible slots by viewport", () => {
    expect(boostSlotClass(0)).toBe("");
    expect(boostSlotClass(1)).toBe("");
    expect(boostSlotClass(2)).toBe("hidden md:block");
    expect(boostSlotClass(3)).toBe("hidden lg:block");
    expect(boostSlotClass(4)).toBe("hidden");
  });

  it("appends cursor pages without duplicates", () => {
    const a = [{ publicId: "1" }, { publicId: "2" }];
    expect(appendUnique(a, [{ publicId: "2" }, { publicId: "3" }]).map((i) => i.publicId)).toEqual(["1", "2", "3"]);
  });
});
