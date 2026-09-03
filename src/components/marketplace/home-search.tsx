"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aznInputToMinor } from "@/lib/format";
import { CATEGORY_LABELS, GROUP_LABELS, UI } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import { engineCcOptions } from "@/lib/marketplace/engine-options";
import { MultiSelectField } from "@/components/marketplace/multi-select";
import {
  csvFromIds,
  GROUP_TO_PARAM,
  MULTI_SELECT_GROUPS,
  searchHref,
  visibleFilterGroups,
  type SearchFilterState,
} from "@/lib/marketplace/search-params";
import type { BrandDto, CategoryDto, CityDto, ModelDto, ReferenceOptionDto } from "@/services/catalog";

const selectClass =
  "mt-1.5 block min-h-12 w-full rounded-control border border-line-strong bg-raised px-3 text-sm text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none disabled:bg-sunken disabled:text-muted";

const advancedField =
  "min-h-12 w-full rounded-control border border-line-strong bg-raised px-3 text-sm text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none";

function digitsOnly(event: FormEvent<HTMLInputElement>) {
  const el = event.currentTarget;
  const digits = el.value.replace(/\D/g, "");
  if (el.value !== digits) el.value = digits;
}

/** Server-loaded reference data for the inline advanced panel. */
export interface HomeAdvancedCatalog {
  cities: CityDto[];
  /** Authoritative year options, newest first (server-computed). */
  years: number[];
  /** Reference options per category per group (existing catalog scoping). */
  optionsByCategory: Record<string, Record<string, ReferenceOptionDto[]>>;
}

/**
 * Hero search (Phase 4.17O.2): category → brand → model plus an
 * inline expandable advanced panel — manual price/mileage entry (no
 * steppers, no spinners), authoritative year dropdowns, engine
 * displacement dropdowns, multi-select fuel/transmission/color (with
 * color swatches), and directly visible condition checkboxes.
 * Submission flows through the EXISTING URL-as-state serializer to
 * /elanlar — never a second search-state architecture. The advanced
 * region stays mounted and toggles via the `hidden` attribute, so
 * selections survive collapse/expand by construction.
 */
export function HomeSearch({
  categories,
  initialBrands,
  advanced,
}: {
  categories: CategoryDto[];
  initialBrands: BrandDto[];
  advanced: HomeAdvancedCatalog;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [category, setCategory] = useState(categories[0]?.code ?? "CAR");
  const [brands, setBrands] = useState<BrandDto[]>(initialBrands);
  const [models, setModels] = useState<ModelDto[]>([]);
  const [brandId, setBrandId] = useState("");
  const [modelId, setModelId] = useState("");
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clearCount, setClearCount] = useState(0); // remounts multi-selects on Təmizlə
  const requestRef = useRef(0);

  async function loadBrands(nextCategory: string) {
    const ticket = ++requestRef.current;
    try {
      const r = await publicFetch<BrandDto[]>(`/api/v1/catalog/brands?category=${encodeURIComponent(nextCategory)}`);
      if (ticket === requestRef.current) setBrands(r.data);
    } catch {
      if (ticket === requestRef.current) setBrands([]);
    } finally {
      if (ticket === requestRef.current) setLoadingBrands(false);
    }
  }

  function selectCategory(code: string) {
    setCategory(code);
    setBrandId("");
    setModelId("");
    setModels([]);
    setBrands([]);
    setLoadingBrands(true);
    void loadBrands(code);
  }

  async function selectBrand(nextBrandId: string) {
    setBrandId(nextBrandId);
    setModelId("");
    setModels([]);
    if (nextBrandId === "") return;
    try {
      const r = await publicFetch<ModelDto[]>(`/api/v1/catalog/models?category=${encodeURIComponent(category)}&brand_id=${encodeURIComponent(nextBrandId)}`);
      setModels(r.data);
    } catch {
      setModels([]);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // EXACT Search URL contract — same keys and serializer the
    // Search Results page parses back (URL-as-state).
    const next: SearchFilterState = { category };
    if (brandId !== "") next.brand_id = brandId;
    if (modelId !== "") next.model_id = modelId;
    const data = new FormData(event.currentTarget);
    const scalar = ["city_id", "year_min", "year_max", "mileage_max", "engine_cc_min", "engine_cc_max"] as const;
    for (const key of scalar) {
      const value = String(data.get(key) ?? "").trim();
      if (value.length > 0) next[key] = value;
    }
    for (const key of ["price_min", "price_max"] as const) {
      const minor = aznInputToMinor(String(data.get(key) ?? ""));
      if (minor !== null) next[key] = minor;
    }
    for (const key of ["fuel_type_ids", "transmission_ids", "color_ids"] as const) {
      const values = data.getAll(key).map(String).filter((v) => v.length > 0);
      if (values.length > 0) next[key] = csvFromIds(values);
    }
    // Positive claims only — unchecked emits nothing.
    if (data.get("no_accident") === "on") next.no_accident = "true";
    if (data.get("not_repainted") === "on") next.not_repainted = "true";
    router.push(searchHref(next));
  }

  /** Explicit reset only (Təmizlə) — collapse never clears values. */
  function clearAll() {
    formRef.current?.reset();
    setBrandId("");
    setModelId("");
    setModels([]);
    setClearCount((c) => c + 1);
  }

  const groups = visibleFilterGroups(category);
  const options = advanced.optionsByCategory[category] ?? {};

  return (
    <form ref={formRef} onSubmit={submit} className="rounded-[12px] bg-raised p-4 shadow-overlay md:p-5" aria-label="Elan axtarışı">
      <div role="radiogroup" aria-label="Kateqoriya" className="mb-4 flex gap-2">
        {categories.map((c) => (
          <button
            key={c.code}
            type="button"
            role="radio"
            aria-checked={category === c.code}
            data-testid={`category-${c.code}`}
            onClick={() => selectCategory(c.code)}
            className={`min-h-12 flex-1 rounded-control border px-4 text-sm font-semibold transition-colors duration-150 ${category === c.code ? "border-primary bg-primary text-white" : "border-line-strong bg-raised text-ink hover:border-primary hover:text-primary"}`}
          >
            {CATEGORY_LABELS[c.code] ?? c.name}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="block text-xs font-medium text-slate-strong">
          <span className="mb-1 block">{UI.brandLabel}</span>
          <select className={selectClass} value={brandId} onChange={(e) => void selectBrand(e.target.value)} disabled={loadingBrands} data-testid="home-brand">
            <option value="">{UI.any}</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-strong">
          <span className="mb-1 block">{UI.modelLabel}</span>
          <select className={selectClass} value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={brandId === ""} data-testid="home-model">
            <option value="">{UI.any}</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <div className="flex items-end">
          <Button type="submit" className="w-full md:w-auto md:px-8" data-testid="home-search-submit">{UI.search}</Button>
        </div>
      </div>

      {/* Inline advanced panel — stays mounted; `hidden` toggles it. */}
      <div id="home-advanced-filters" hidden={!expanded} data-testid="home-advanced-panel" className="mt-4 border-t border-line pt-4">
        <div className="grid gap-3 md:grid-cols-2 desk:grid-cols-3">
          <label className="block text-xs font-medium text-slate-strong">
            <span className="mb-1 block">{UI.city}</span>
            <select name="city_id" defaultValue="" className={advancedField} data-testid="home-adv-city">
              <option value="">{UI.any}</option>
              {advanced.cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-strong">{UI.price}, AZN</legend>
            <div className="grid grid-cols-2 gap-2">
              <input name="price_min" type="text" inputMode="numeric" placeholder={UI.min} aria-label={`${UI.price} ${UI.min}`} onInput={digitsOnly} className={advancedField} data-testid="home-adv-price-min" />
              <input name="price_max" type="text" inputMode="numeric" placeholder={UI.max} aria-label={`${UI.price} ${UI.max}`} onInput={digitsOnly} className={advancedField} data-testid="home-adv-price-max" />
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-strong">{UI.year}</legend>
            <div className="grid grid-cols-2 gap-2">
              <select name="year_min" defaultValue="" aria-label="Minimum il" className={advancedField} data-testid="home-adv-year-min">
                <option value="">Minimum il</option>
                {advanced.years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <select name="year_max" defaultValue="" aria-label="Maximum il" className={advancedField} data-testid="home-adv-year-max">
                <option value="">Maximum il</option>
                {advanced.years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </fieldset>
          <label className="block text-xs font-medium text-slate-strong">
            <span className="mb-1 block">{UI.mileage}, km ({UI.max})</span>
            <input name="mileage_max" type="text" inputMode="numeric" aria-label={`${UI.mileage} ${UI.max}`} onInput={digitsOnly} className={advancedField} data-testid="home-adv-mileage-max" />
          </label>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-strong">{UI.engineCcTitle}</legend>
            <div className="grid grid-cols-2 gap-2">
              <select name="engine_cc_min" defaultValue="" aria-label={`${UI.engineCcTitle} ${UI.min}`} className={advancedField} data-testid="home-adv-engine-min">
                <option value="">{UI.min}</option>
                {engineCcOptions().map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <select name="engine_cc_max" defaultValue="" aria-label={`${UI.engineCcTitle} ${UI.max}`} className={advancedField} data-testid="home-adv-engine-max">
                <option value="">{UI.max}</option>
                {engineCcOptions().map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </fieldset>
          {groups.filter((group) => MULTI_SELECT_GROUPS.has(group)).map((group) => (
            <MultiSelectField
              key={`${group}-${clearCount}`}
              label={GROUP_LABELS[group]}
              name={GROUP_TO_PARAM[group]}
              options={options[group] ?? []}
              initialSelected={[]}
              swatches={group === "COLOR"}
              testid={`home-adv-${group.toLowerCase()}`}
            />
          ))}
          {groups.filter((group) => !MULTI_SELECT_GROUPS.has(group)).map((group) => (
            <label key={group} className="block text-xs font-medium text-slate-strong">
              <span className="mb-1 block">{GROUP_LABELS[group]}</span>
              <select name={GROUP_TO_PARAM[group]} defaultValue="" className={advancedField} data-testid={`home-adv-${GROUP_TO_PARAM[group]}`}>
                <option value="">{UI.any}</option>
                {(options[group] ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          ))}
        </div>
        {/* Condition claims stay directly visible — never inside a menu. */}
        <fieldset className="mt-3">
          <legend className="mb-1 text-xs font-medium text-slate-strong">{UI.conditionTitle}</legend>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex min-h-12 items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="no_accident" className="size-5 accent-primary" data-testid="home-adv-no-accident" /> {UI.noAccident}
            </label>
            <label className="inline-flex min-h-12 items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="not_repainted" className="size-5 accent-primary" data-testid="home-adv-not-repainted" /> {UI.notRepainted}
            </label>
          </div>
        </fieldset>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex min-h-12 items-center rounded-control px-3 text-sm font-medium text-slate-strong transition-colors duration-150 hover:text-ink"
            data-testid="home-adv-clear"
          >
            Təmizlə
          </button>
        </div>
      </div>

      <div className="mt-3 flex justify-start">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="home-advanced-filters"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex min-h-12 items-center gap-1 rounded-control px-1 text-sm font-medium text-primary transition-colors duration-150 hover:text-primary-hover"
          data-testid="home-advanced-toggle"
        >
          {expanded ? "Ətraflı axtarışı gizlət" : "Ətraflı axtarış"}
          {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
        </button>
      </div>
    </form>
  );
}
