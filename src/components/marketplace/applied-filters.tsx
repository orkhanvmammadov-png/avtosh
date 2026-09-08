import Link from "next/link";
import { minorToAznInput } from "@/lib/format";
import { UI } from "@/lib/marketplace/labels";
import {
  csvFromIds,
  GROUP_TO_PARAM,
  idsFromCsv,
  MULTI_SELECT_GROUPS,
  searchHref,
  visibleFilterGroups,
  type SearchFilterState,
} from "@/lib/marketplace/search-params";

/**
 * Server-rendered applied-filter chips (O.6 presentation, unchanged
 * URL semantics). Each chip is a plain link to the same search URL
 * minus that filter — URL-as-state is preserved exactly (no client
 * mutation, no new state model).
 */

import type { BrandDto, CategoryDto, CityDto, FeatureDto, ModelDto, ReferenceOptionDto } from "@/services/catalog";

/** Catalog rows the chips (label lookup) need. */
export interface FilterCatalog {
  categories: CategoryDto[];
  /** Authoritative year options, newest first (server-computed). */
  years: number[];
  brands: BrandDto[];
  models: ModelDto[];
  cities: CityDto[];
  options: Record<string, ReferenceOptionDto[]>;
  features: FeatureDto[];
}

interface Chip {
  key: string;
  label: string;
  href: string;
}

/** Approved chip display grouping ("30 000–70 000 AZN"). */
function spaced(raw: string): string {
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function without(state: SearchFilterState, keys: (keyof SearchFilterState)[]): string {
  const next: SearchFilterState = { ...state };
  for (const key of keys) delete next[key];
  return searchHref(next);
}

export function appliedFilterChips(state: SearchFilterState, catalog: FilterCatalog): Chip[] {
  const chips: Chip[] = [];
  const name = (rows: { id: string; name: string }[], id?: string) =>
    rows.find((row) => row.id === id)?.name;

  const brand = name(catalog.brands, state.brand_id);
  if (brand !== undefined) {
    chips.push({ key: "brand", label: brand, href: without(state, ["brand_id", "model_id"]) });
  }
  const model = name(catalog.models, state.model_id);
  if (model !== undefined) {
    chips.push({ key: "model", label: model, href: without(state, ["model_id"]) });
  }
  const city = name(catalog.cities, state.city_id);
  if (city !== undefined) {
    chips.push({ key: "city", label: city, href: without(state, ["city_id"]) });
  }
  if (state.price_min !== undefined || state.price_max !== undefined) {
    const min = state.price_min !== undefined ? spaced(minorToAznInput(state.price_min)) : "…";
    const max = state.price_max !== undefined ? spaced(minorToAznInput(state.price_max)) : "…";
    chips.push({
      key: "price",
      label: `${min}–${max} AZN`,
      href: without(state, ["price_min", "price_max"]),
    });
  }
  if (state.year_min !== undefined || state.year_max !== undefined) {
    chips.push({
      key: "year",
      label: `${state.year_min ?? "…"}–${state.year_max ?? "…"}`,
      href: without(state, ["year_min", "year_max"]),
    });
  }
  if (state.mileage_max !== undefined) {
    chips.push({
      key: "mileage",
      label: `≤ ${spaced(state.mileage_max)} km`,
      href: without(state, ["mileage_max"]),
    });
  }
  if (state.engine_cc_min !== undefined || state.engine_cc_max !== undefined) {
    chips.push({
      key: "engine",
      label: `${state.engine_cc_min ?? "…"}–${state.engine_cc_max ?? "…"} sm³`,
      href: without(state, ["engine_cc_min", "engine_cc_max"]),
    });
  }
  for (const group of visibleFilterGroups(state.category ?? "CAR")) {
    const param = GROUP_TO_PARAM[group];
    if (MULTI_SELECT_GROUPS.has(group)) {
      // one removable chip PER selected value — removing one keeps the rest
      const selectedIds = idsFromCsv(state[param]);
      for (const id of selectedIds) {
        const option = name(catalog.options[group] ?? [], id);
        if (option === undefined) continue;
        const rest = selectedIds.filter((v) => v !== id);
        const next: SearchFilterState = { ...state };
        if (rest.length > 0) next[param] = csvFromIds(rest);
        else delete next[param];
        chips.push({ key: `${param}-${id}`, label: option, href: searchHref(next) });
      }
      continue;
    }
    const option = name(catalog.options[group] ?? [], state[param]);
    if (option !== undefined) {
      chips.push({ key: param, label: option, href: without(state, [param]) });
    }
  }
  if (state.no_accident === "true") {
    chips.push({ key: "no_accident", label: UI.noAccident, href: without(state, ["no_accident"]) });
  }
  if (state.not_repainted === "true") {
    chips.push({ key: "not_repainted", label: UI.notRepainted, href: without(state, ["not_repainted"]) });
  }
  if (state.credit === "true") chips.push({ key: "credit", label: UI.credit, href: without(state, ["credit"]) });
  if (state.barter === "true") chips.push({ key: "barter", label: UI.barter, href: without(state, ["barter"]) });
  for (const featureId of (state.feature_ids ?? "").split(",").filter((v) => v.length > 0)) {
    const feature = catalog.features.find((f) => f.id === featureId);
    if (feature === undefined) continue;
    const rest = (state.feature_ids ?? "").split(",").filter((v) => v !== featureId && v.length > 0);
    const next: SearchFilterState = { ...state };
    if (rest.length > 0) next.feature_ids = rest.join(",");
    else delete next.feature_ids;
    chips.push({ key: `feature-${featureId}`, label: feature.name, href: searchHref(next) });
  }
  return chips;
}

export function AppliedFilters({ state, catalog }: { state: SearchFilterState; catalog: FilterCatalog }) {
  const chips = appliedFilterChips(state, catalog);
  if (chips.length === 0) return null;
  return (
    // O.6 chip recipe: white pill h30 (28 @≤768), strong border, ✕ in
    // an 18px circle with the danger hover tint; chips wrap, never
    // scroll; the "Təmizlə" ghost ends the row.
    <ul className="flex flex-wrap items-center gap-[7px]" data-testid="applied-filters">
      {chips.map((chip) => (
        <li key={chip.key}>
          <Link
            href={chip.href}
            className="inline-flex min-h-[30px] items-center gap-1 rounded-pill border border-line-strong bg-raised py-1 pl-[11px] pr-1.5 text-[12px] font-medium text-ink transition-colors duration-150 hover:border-muted focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 md:min-h-[30px] max-md:min-h-7 max-md:text-[11.5px]"
            data-testid="applied-filter"
          >
            {chip.label}
            <span
              aria-hidden="true"
              className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-pill text-[11px] font-semibold text-muted transition-colors duration-150 hover:bg-[#F9E4E1] hover:text-[#B3261E]"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </span>
          </Link>
        </li>
      ))}
      <li>
        <Link
          href={searchHref({ category: state.category, sort: state.sort })}
          className="inline-flex min-h-[30px] items-center px-2 text-[12px] font-semibold text-primary transition-colors duration-150 hover:text-primary-hover max-md:min-h-7"
          data-testid="applied-clear-all"
        >
          {UI.clearFilters}
        </Link>
      </li>
    </ul>
  );
}
