import Link from "next/link";
import type { FilterCatalog } from "@/components/marketplace/search-filters";
import { minorToAznInput } from "@/lib/format";
import { GROUP_LABELS, UI } from "@/lib/marketplace/labels";
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
 * Server-rendered applied-filter chips. Each chip is a plain link to
 * the same search URL minus that filter — URL-as-state is preserved
 * exactly (no client mutation, no new state model).
 */

interface Chip {
  key: string;
  label: string;
  href: string;
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
    const min = state.price_min !== undefined ? minorToAznInput(state.price_min) : null;
    const max = state.price_max !== undefined ? minorToAznInput(state.price_max) : null;
    chips.push({
      key: "price",
      label: `${UI.price}: ${min ?? "…"}–${max ?? "…"} AZN`,
      href: without(state, ["price_min", "price_max"]),
    });
  }
  if (state.year_min !== undefined || state.year_max !== undefined) {
    chips.push({
      key: "year",
      label: `${UI.year}: ${state.year_min ?? "…"}–${state.year_max ?? "…"}`,
      href: without(state, ["year_min", "year_max"]),
    });
  }
  if (state.mileage_max !== undefined) {
    chips.push({
      key: "mileage",
      label: `${UI.mileage} ≤ ${state.mileage_max} km`,
      href: without(state, ["mileage_max"]),
    });
  }
  if (state.engine_cc_min !== undefined || state.engine_cc_max !== undefined) {
    chips.push({
      key: "engine",
      label: `${UI.engineCcTitle}: ${state.engine_cc_min ?? "…"}–${state.engine_cc_max ?? "…"}`,
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
      chips.push({ key: param, label: `${GROUP_LABELS[group]}: ${option}`, href: without(state, [param]) });
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
    <ul className="flex flex-wrap items-center gap-1.5" data-testid="applied-filters">
      {chips.map((chip) => (
        <li key={chip.key}>
          <Link
            href={chip.href}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-pill bg-primary-tint px-3 text-xs font-semibold text-primary-pressed transition-colors duration-150 hover:bg-primary-tint-pressed"
            data-testid="applied-filter"
          >
            {chip.label}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
        </li>
      ))}
      {chips.length > 1 ? (
        <li>
          <Link
            href={searchHref({ category: state.category, sort: state.sort })}
            className="inline-flex min-h-9 items-center px-2 text-xs font-medium text-slate-strong underline-offset-2 transition-colors duration-150 hover:text-danger hover:underline"
            data-testid="applied-clear-all"
          >
            {UI.clearFilters}
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
