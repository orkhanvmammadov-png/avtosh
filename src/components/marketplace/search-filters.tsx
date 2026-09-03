"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { aznInputToMinor, minorToAznInput } from "@/lib/format";
import { engineCcOptions } from "@/lib/marketplace/engine-options";
import { MultiSelectField } from "@/components/marketplace/multi-select";
import { CATEGORY_LABELS, GROUP_LABELS, UI } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import {
  csvFromIds,
  filtersForCategoryChange,
  GROUP_TO_PARAM,
  idsFromCsv,
  MULTI_SELECT_GROUPS,
  searchHref,
  visibleFilterGroups,
  type SearchFilterState,
} from "@/lib/marketplace/search-params";
import type { BrandDto, CategoryDto, CityDto, FeatureDto, ModelDto, ReferenceOptionDto } from "@/services/catalog";

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

function digitsOnly(event: React.FormEvent<HTMLInputElement>) {
  const el = event.currentTarget;
  const digits = el.value.replace(/\D/g, "");
  if (el.value !== digits) el.value = digits;
}

const field = "min-h-10 w-full rounded-control border border-line-strong bg-raised px-3 text-sm text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none disabled:bg-sunken disabled:text-muted max-md:min-h-12";

function FilterForm({ state, catalog, onApplied }: { state: SearchFilterState; catalog: FilterCatalog; onApplied?: () => void }) {
  const router = useRouter();
  const category = state.category ?? "CAR";
  const [brandId, setBrandId] = useState(state.brand_id ?? "");
  const [models, setModels] = useState<ModelDto[]>(catalog.models);

  // Dependent models when the brand changes (server rendered the initial set).
  async function selectBrand(nextBrandId: string) {
    setBrandId(nextBrandId);
    if (nextBrandId === "") { setModels([]); return; }
    if (nextBrandId === state.brand_id) { setModels(catalog.models); return; }
    try {
      const r = await publicFetch<ModelDto[]>(`/api/v1/catalog/models?category=${encodeURIComponent(category)}&brand_id=${encodeURIComponent(nextBrandId)}`);
      setModels(r.data);
    } catch {
      setModels([]);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: SearchFilterState = { category, sort: state.sort };
    const scalar = ["brand_id", "model_id", "city_id", "year_min", "year_max", "mileage_max",
      "engine_cc_min", "engine_cc_max", "body_type_id", "drive_type_id", "motorcycle_type_id"] as const;
    for (const key of scalar) {
      const value = String(data.get(key) ?? "").trim();
      if (value.length > 0) next[key] = value;
    }
    // Multi-select groups: every checked value, canonical CSV param.
    for (const key of ["fuel_type_ids", "transmission_ids", "color_ids"] as const) {
      const values = data.getAll(key).map(String).filter((v) => v.length > 0);
      if (values.length > 0) next[key] = csvFromIds(values);
    }
    // Positive condition claims only — unchecked emits nothing.
    if (data.get("no_accident") === "on") next.no_accident = "true";
    if (data.get("not_repainted") === "on") next.not_repainted = "true";
    // Buyers type whole AZN; the URL/API carry minor units (exact integer conversion).
    for (const key of ["price_min", "price_max"] as const) {
      const minor = aznInputToMinor(String(data.get(key) ?? ""));
      if (minor !== null) next[key] = minor;
    }
    if (data.get("credit") === "on") next.credit = "true";
    if (data.get("barter") === "on") next.barter = "true";
    const features = data.getAll("feature_ids").map(String).filter((v) => v.length > 0);
    if (features.length > 0) next.feature_ids = features.join(",");
    router.push(searchHref(next));
    onApplied?.();
  }

  const groups = visibleFilterGroups(category);
  return (
    <form onSubmit={submit} className="space-y-4" aria-label={UI.filters} data-testid="filter-form">
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-slate-strong">Kateqoriya</legend>
        <div className="flex gap-2">
          {catalog.categories.map((c) => (
            <Link
              key={c.code}
              href={searchHref(filtersForCategoryChange(state, c.code))}
              aria-current={category === c.code ? "page" : undefined}
              data-testid={`filter-category-${c.code}`}
              className={`min-h-11 flex-1 rounded-control border px-3 text-center text-sm font-semibold leading-[42px] transition-colors duration-150 ${category === c.code ? "border-primary bg-primary text-white" : "border-line-strong bg-raised text-ink hover:border-primary hover:text-primary"}`}
            >
              {CATEGORY_LABELS[c.code] ?? c.name}
            </Link>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm font-medium"><span className="mb-1 block">{UI.brandLabel}</span>
        <select name="brand_id" className={field} value={brandId} onChange={(e) => void selectBrand(e.target.value)} data-testid="filter-brand">
          <option value="">{UI.any}</option>
          {catalog.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium"><span className="mb-1 block">{UI.modelLabel}</span>
        <select name="model_id" className={field} defaultValue={state.model_id ?? ""} disabled={brandId === ""} data-testid="filter-model">
          <option value="">{UI.any}</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium"><span className="mb-1 block">{UI.city}</span>
        <select name="city_id" className={field} defaultValue={state.city_id ?? ""} data-testid="filter-city">
          <option value="">{UI.any}</option>
          {catalog.cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">{UI.price}, AZN</legend>
        <div className="grid grid-cols-2 gap-2">
          <input name="price_min" type="text" inputMode="numeric" placeholder={UI.min} aria-label={`${UI.price} ${UI.min}`} defaultValue={minorToAznInput(state.price_min)} onInput={digitsOnly} className={field} data-testid="filter-price-min" />
          <input name="price_max" type="text" inputMode="numeric" placeholder={UI.max} aria-label={`${UI.price} ${UI.max}`} defaultValue={minorToAznInput(state.price_max)} onInput={digitsOnly} className={field} data-testid="filter-price-max" />
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{UI.year}</legend>
        <div className="grid grid-cols-2 gap-2">
          <select name="year_min" aria-label="Minimum il" defaultValue={state.year_min ?? ""} className={field} data-testid="filter-year-min">
            <option value="">Minimum il</option>
            {catalog.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select name="year_max" aria-label="Maximum il" defaultValue={state.year_max ?? ""} className={field} data-testid="filter-year-max">
            <option value="">Maximum il</option>
            {catalog.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </fieldset>
      <label className="block text-sm font-medium"><span className="mb-1 block">{UI.mileage}, km ({UI.max})</span>
        <input name="mileage_max" type="text" inputMode="numeric" aria-label={`${UI.mileage} ${UI.max}`} defaultValue={state.mileage_max ?? ""} onInput={digitsOnly} className={field} data-testid="filter-mileage-max" />
      </label>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{UI.engineCcTitle}</legend>
        <div className="grid grid-cols-2 gap-2">
          <select name="engine_cc_min" aria-label={`${UI.engineCcTitle} ${UI.min}`} defaultValue={state.engine_cc_min ?? ""} className={field} data-testid="filter-engine-min">
            <option value="">{UI.min}</option>
            {engineCcOptions().map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select name="engine_cc_max" aria-label={`${UI.engineCcTitle} ${UI.max}`} defaultValue={state.engine_cc_max ?? ""} className={field} data-testid="filter-engine-max">
            <option value="">{UI.max}</option>
            {engineCcOptions().map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </fieldset>

      {groups.map((group) => {
        const param = GROUP_TO_PARAM[group];
        const options = catalog.options[group] ?? [];
        if (MULTI_SELECT_GROUPS.has(group)) {
          return (
            <div key={`${group}-${state[param] ?? ""}`} data-testid={`filter-group-${group}`}>
              <MultiSelectField
                label={GROUP_LABELS[group]}
                name={param}
                options={options}
                initialSelected={idsFromCsv(state[param])}
                swatches={group === "COLOR"}
                testid={`filter-${group.toLowerCase()}`}
              />
            </div>
          );
        }
        return (
          <label key={group} className="block text-sm font-medium" data-testid={`filter-group-${group}`}>
            <span className="mb-1 block">{GROUP_LABELS[group]}</span>
            <select name={param} className={field} defaultValue={state[param] ?? ""}>
              <option value="">{UI.any}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        );
      })}

      <fieldset data-testid="filter-condition">
        <legend className="mb-1 text-sm font-medium">{UI.conditionTitle}</legend>
        <div className="flex flex-col">
          <label className="inline-flex min-h-12 items-center gap-2 text-sm">
            <input type="checkbox" name="no_accident" defaultChecked={state.no_accident === "true"} className="size-5 accent-primary" data-testid="filter-no-accident" /> {UI.noAccident}
          </label>
          <label className="inline-flex min-h-12 items-center gap-2 text-sm">
            <input type="checkbox" name="not_repainted" defaultChecked={state.not_repainted === "true"} className="size-5 accent-primary" data-testid="filter-not-repainted" /> {UI.notRepainted}
          </label>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className="inline-flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" name="credit" defaultChecked={state.credit === "true"} className="size-5 accent-primary" /> {UI.credit}</label>
        <label className="inline-flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" name="barter" defaultChecked={state.barter === "true"} className="size-5 accent-primary" /> {UI.barter}</label>
      </div>

      {catalog.features.length > 0 ? (
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{UI.features}</legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {catalog.features.map((f) => (
              <label key={f.id} className="inline-flex min-h-12 items-center gap-2 text-sm">
                <input type="checkbox" name="feature_ids" value={f.id} defaultChecked={(state.feature_ids ?? "").split(",").includes(f.id)} className="size-5 accent-primary" /> {f.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-2 pt-2">
        <Button type="submit" data-testid="filter-apply">Nəticələri göstər</Button>
        <Link href={searchHref({ category })} className={buttonClasses("ghost")} data-testid="filter-clear" onClick={() => onApplied?.()}>{UI.clearFilters}</Link>
      </div>
    </form>
  );
}

/**
 * Desktop/laptop (desk:, 1024+): persistent sidebar rail. Below that:
 * a native <dialog> drawer (focus trapped, Esc closes) opened by the
 * toolbar's FiltersTrigger via the element id.
 */
export function SearchFilters({ state, catalog }: { state: SearchFilterState; catalog: FilterCatalog }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <>
      <aside aria-label={UI.filters} className="hidden desk:block desk:w-[232px] desk:shrink-0 xl:w-[272px]" data-testid="filters-desktop">
        <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-card border border-line bg-raised p-4">
          <h2 className="mb-3 text-base font-bold text-ink">{UI.filters}</h2>
          <FilterForm state={state} catalog={catalog} />
        </div>
      </aside>
      <dialog
        id="search-filters-drawer"
        ref={dialogRef}
        aria-label={UI.filters}
        className="m-0 mt-auto max-h-[85vh] w-full max-w-none rounded-t-modal bg-raised p-0 backdrop:bg-scrim desk:hidden"
        data-testid="filters-drawer"
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-pill bg-line-strong" />
        <div className="flex items-center justify-between px-4 py-2">
          <h2 className="text-base font-bold text-ink">{UI.filters}</h2>
          <button type="button" aria-label="Filterləri bağla" className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-control hover:bg-surface" onClick={() => dialogRef.current?.close()} data-testid="filters-close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="max-h-[calc(85vh-64px)] overflow-y-auto px-4 pb-6 pt-1">
          <FilterForm state={state} catalog={catalog} onApplied={() => dialogRef.current?.close()} />
        </div>
      </dialog>
    </>
  );
}
