"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aznInputToMinor } from "@/lib/format";
import { CATEGORY_LABELS, GROUP_LABELS, UI } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import {
  GROUP_TO_PARAM,
  searchHref,
  visibleFilterGroups,
  type SearchFilterState,
} from "@/lib/marketplace/search-params";
import type { BrandDto, CategoryDto, CityDto, ModelDto, ReferenceOptionDto } from "@/services/catalog";

const selectClass =
  "mt-1.5 block min-h-12 w-full rounded-control border border-line-strong bg-raised px-3 text-sm text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none disabled:bg-sunken disabled:text-muted";

const advancedField =
  "min-h-12 w-full rounded-control border border-line-strong bg-raised px-3 text-sm text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none";

/** Server-loaded reference data for the inline advanced panel (4.17O.2). */
export interface HomeAdvancedCatalog {
  cities: CityDto[];
  /** Reference options per category per group (existing catalog scoping). */
  optionsByCategory: Record<string, Record<string, ReferenceOptionDto[]>>;
}

/**
 * Hero search: category → brands → models, plus an inline expandable
 * advanced panel (Phase 4.17O.2). Submission navigates to /elanlar
 * through the EXISTING URL-as-state serializer — the panel is only an
 * additional entry surface, never a second search-state architecture.
 * The advanced region stays mounted and is toggled with the `hidden`
 * attribute, so selected values survive collapse/expand by
 * construction and no measured-height animation is needed.
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
    // EXACT Search URL contract: the same SearchFilterState keys and
    // serializer the Search Results page parses back (URL-as-state).
    const next: SearchFilterState = { category };
    if (brandId !== "") next.brand_id = brandId;
    if (modelId !== "") next.model_id = modelId;
    const data = new FormData(event.currentTarget);
    const scalar = ["city_id", "year_min", "year_max", "mileage_max",
      "fuel_type_id", "transmission_id", "body_type_id", "drive_type_id", "motorcycle_type_id", "color_id"] as const;
    for (const key of scalar) {
      const value = String(data.get(key) ?? "").trim();
      if (value.length > 0) next[key] = value;
    }
    // Buyers type whole AZN; the URL/API carry minor units.
    for (const key of ["price_min", "price_max"] as const) {
      const minor = aznInputToMinor(String(data.get(key) ?? ""));
      if (minor !== null) next[key] = minor;
    }
    if (data.get("credit") === "on") next.credit = "true";
    if (data.get("barter") === "on") next.barter = "true";
    router.push(searchHref(next));
  }

  /** Explicit reset only (Təmizlə) — collapse never clears values. */
  function clearAll() {
    formRef.current?.reset();
    setBrandId("");
    setModelId("");
    setModels([]);
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
              <input name="price_min" type="number" inputMode="numeric" min={1} placeholder={UI.min} aria-label={`${UI.price} ${UI.min}`} className={advancedField} data-testid="home-adv-price-min" />
              <input name="price_max" type="number" inputMode="numeric" min={1} placeholder={UI.max} aria-label={`${UI.price} ${UI.max}`} className={advancedField} data-testid="home-adv-price-max" />
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-strong">{UI.year}</legend>
            <div className="grid grid-cols-2 gap-2">
              <input name="year_min" type="number" inputMode="numeric" min={1900} max={2100} placeholder={UI.min} aria-label={`${UI.year} ${UI.min}`} className={advancedField} data-testid="home-adv-year-min" />
              <input name="year_max" type="number" inputMode="numeric" min={1900} max={2100} placeholder={UI.max} aria-label={`${UI.year} ${UI.max}`} className={advancedField} data-testid="home-adv-year-max" />
            </div>
          </fieldset>
          <label className="block text-xs font-medium text-slate-strong">
            <span className="mb-1 block">{UI.mileage}, km ({UI.max})</span>
            <input name="mileage_max" type="number" inputMode="numeric" min={0} className={advancedField} data-testid="home-adv-mileage-max" />
          </label>
          {groups.map((group) => (
            <label key={group} className="block text-xs font-medium text-slate-strong">
              <span className="mb-1 block">{GROUP_LABELS[group]}</span>
              <select name={GROUP_TO_PARAM[group]} defaultValue="" className={advancedField} data-testid={`home-adv-${GROUP_TO_PARAM[group]}`}>
                <option value="">{UI.any}</option>
                {(options[group] ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex min-h-12 items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="credit" className="size-5 accent-primary" data-testid="home-adv-credit" /> {UI.credit}
            </label>
            <label className="inline-flex min-h-12 items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="barter" className="size-5 accent-primary" data-testid="home-adv-barter" /> {UI.barter}
            </label>
          </div>
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
