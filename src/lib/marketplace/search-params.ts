import { LISTING_YEAR_MIN, listingYearMax, SEARCH_SORTS, type SearchSort } from "@/lib/config/marketplace";

/**
 * URL ⇄ search-filter model. URL parameter names are EXACTLY the Phase
 * 4.8 API names, so the browser URL is both shareable and directly
 * forwardable to /api/v1/listings. Nothing here re-implements search
 * rules — it only serializes/normalizes.
 */

export const FILTER_KEYS = [
  "category",
  "brand_id",
  "model_id",
  "city_id",
  "price_min",
  "price_max",
  "year_min",
  "year_max",
  "mileage_max",
  "engine_cc_min",
  "engine_cc_max",
  // Legacy singular spellings are PARSED for bookmarked URLs but
  // normalized into the canonical plural CSV keys below — serialized
  // state never carries them (see filtersFromSearchParams).
  "fuel_type_id",
  "transmission_id",
  "color_id",
  "fuel_type_ids",
  "transmission_ids",
  "color_ids",
  "body_type_id",
  "drive_type_id",
  "motorcycle_type_id",
  "credit",
  "barter",
  "no_accident",
  "not_repainted",
  "feature_ids",
  "sort",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];
export type SearchFilterState = Partial<Record<FilterKey, string>>;

/** Reads only known keys (first value), dropping empties. */
export function filtersFromSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): SearchFilterState {
  const get = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) {
      return params.get(key) ?? undefined;
    }
    const raw = params[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  const state: SearchFilterState = {};
  for (const key of FILTER_KEYS) {
    const value = get(key)?.trim();
    if (value !== undefined && value.length > 0) {
      state[key] = value;
    }
  }
  // Canonicalize legacy singular params into the plural CSV keys
  // (merged + deduplicated) so one representation flows everywhere.
  const LEGACY: [FilterKey, FilterKey][] = [
    ["fuel_type_id", "fuel_type_ids"],
    ["transmission_id", "transmission_ids"],
    ["color_id", "color_ids"],
  ];
  for (const [singular, plural] of LEGACY) {
    const single = state[singular];
    if (single === undefined) continue;
    state[plural] = [...new Set([...idsFromCsv(state[plural]), single])].join(",");
    delete state[singular];
  }
  // Condition params carry positive claims only.
  if (state.no_accident !== "true") delete state.no_accident;
  if (state.not_repainted !== "true") delete state.not_repainted;
  // Legacy year URLs (pre-4.17O.2 allowed up to 2100): canonicalize
  // out-of-range years to the accepted boundary instead of failing
  // the page; re-serialized URLs then carry the legal value.
  for (const key of ["year_min", "year_max"] as const) {
    const raw = state[key];
    if (raw === undefined) continue;
    const year = Number(raw);
    if (!Number.isInteger(year)) {
      delete state[key];
    } else if (year < LISTING_YEAR_MIN) {
      state[key] = String(LISTING_YEAR_MIN);
    } else if (year > listingYearMax()) {
      state[key] = String(listingYearMax());
    }
  }
  return state;
}

/** CSV state value → deduplicated id array ("" and undefined → []). */
export function idsFromCsv(value: string | undefined): string[] {
  if (value === undefined) return [];
  return [...new Set(value.split(",").map((s) => s.trim()).filter((s) => s.length > 0))];
}

/** Deterministic canonical CSV for multi-select state (dedup, insertion order). */
export function csvFromIds(ids: string[]): string {
  return [...new Set(ids)].join(",");
}

/** Deterministic, minimal query string (known keys, fixed order, no empties). */
export function filtersToQueryString(state: SearchFilterState): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = state[key];
    if (value !== undefined && value.length > 0 && !(key === "sort" && value === "NEWEST")) {
      params.set(key, value);
    }
  }
  return params.toString();
}

export function searchHref(state: SearchFilterState): string {
  const qs = filtersToQueryString(state);
  return qs.length === 0 ? "/elanlar" : `/elanlar?${qs}`;
}

export function normalizeSort(value: string | undefined): SearchSort {
  return (SEARCH_SORTS as readonly string[]).includes(value ?? "") ? (value as SearchSort) : "NEWEST";
}

/**
 * Category-specific control visibility (mirrors catalog scoping:
 * BODY_TYPE/DRIVE_TYPE are car concepts, MOTORCYCLE_TYPE is a
 * motorcycle concept; the rest are global).
 */
export function visibleFilterGroups(category: string): string[] {
  const shared = ["FUEL_TYPE", "TRANSMISSION", "COLOR"];
  if (category === "MOTORCYCLE") return ["MOTORCYCLE_TYPE", ...shared];
  return ["BODY_TYPE", "DRIVE_TYPE", ...shared];
}

export const GROUP_TO_PARAM: Record<string, FilterKey> = {
  FUEL_TYPE: "fuel_type_ids",
  TRANSMISSION: "transmission_ids",
  BODY_TYPE: "body_type_id",
  DRIVE_TYPE: "drive_type_id",
  MOTORCYCLE_TYPE: "motorcycle_type_id",
  COLOR: "color_ids",
};

/** Groups whose param carries a CSV of ids (multi-select, OR semantics). */
export const MULTI_SELECT_GROUPS = new Set(["FUEL_TYPE", "TRANSMISSION", "COLOR"]);

/** Drops filters that no longer apply when the category changes. */
export function filtersForCategoryChange(state: SearchFilterState, category: string): SearchFilterState {
  const next: SearchFilterState = { ...state, category };
  delete next.brand_id;
  delete next.model_id;
  delete next.feature_ids;
  const allowed = new Set(visibleFilterGroups(category).map((g) => GROUP_TO_PARAM[g]));
  for (const [group, param] of Object.entries(GROUP_TO_PARAM)) {
    if (!allowed.has(param)) delete next[param];
    void group;
  }
  return next;
}

/** Accepted first-view Boost capacity per viewport class. */
export const BOOST_VISIBLE_SLOTS = { mobile: 2, tablet: 3, desktop: 4 } as const;

/** Tailwind visibility classes so the API's ≤4 candidates collapse to 2/3/4 by viewport. */
export function boostSlotClass(index: number): string {
  if (index < BOOST_VISIBLE_SLOTS.mobile) return "";
  if (index < BOOST_VISIBLE_SLOTS.tablet) return "hidden md:block";
  if (index < BOOST_VISIBLE_SLOTS.desktop) return "hidden lg:block";
  return "hidden";
}

/** Appends a page while guarding against duplicates across cursor pages. */
export function appendUnique<T extends { publicId: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((i) => i.publicId));
  return [...current, ...incoming.filter((i) => !seen.has(i.publicId))];
}
