"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { aznInputToMinor } from "@/lib/format";
import { CATEGORY_LABELS, GROUP_LABELS, UI } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import { engineCcOptions } from "@/lib/marketplace/engine-options";
import { MultiSelectField } from "@/components/marketplace/multi-select";
import {
  csvFromIds,
  GROUP_TO_PARAM,
  searchHref,
  visibleFilterGroups,
  type SearchFilterState,
} from "@/lib/marketplace/search-params";
import type { BrandDto, CategoryDto, CityDto, ModelDto, ReferenceOptionDto } from "@/services/catalog";

/**
 * Home search — approved Direction 1C (design_handoff_avtosh/
 * advanced_search): compact core row (Marka · Model · Şəhər · Axtar),
 * then the inline advanced zone with the mandated 1–10 DOM reading
 * order. Visual placement (price spine at 1440/1024, price band at
 * 768/390) is done with grid-template-areas so the source order never
 * changes. All functional O.2 contracts (params, serializer,
 * semantics, dismissal behaviors) are preserved unchanged.
 */

/** Direction 1C standard closed control: h40 desktop / h44 @390. */
const control =
  "min-h-10 w-full rounded-control border border-line-strong bg-raised px-3 text-[13px] text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none focus:shadow-[0_0_0_2px_rgba(20,122,78,0.25)] disabled:bg-raised disabled:text-muted disabled:border-line max-sm:min-h-11";

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Display grouping per the approved frames ("25 000", "123 500"). */
function groupThousands(raw: string): string {
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Field label per tokens.md (12/500 secondary, 6px gap). */
function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[12px] font-medium text-slate-strong">{children}</span>;
}

/** Native select in 1C clothing: custom chevron, optional ✕ clear. */
function Select1C({
  name,
  ariaLabel,
  placeholder,
  optionItems,
  clearable = false,
  testid,
}: {
  name: string;
  ariaLabel: string;
  placeholder: string;
  optionItems: { value: string; label: string }[];
  clearable?: boolean;
  testid: string;
}) {
  const [value, setValue] = useState("");
  return (
    <span className="relative block">
      <select
        name={name}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`${control} appearance-none ${clearable && value !== "" ? "pr-14" : "pr-8"} ${value !== "" ? "font-medium" : "text-muted"}`}
        data-testid={testid}
      >
        <option value="">{placeholder}</option>
        {optionItems.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {clearable && value !== "" ? (
        <button
          type="button"
          aria-label={`${ariaLabel} — təmizlə`}
          onClick={() => setValue("")}
          className="absolute right-7 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center text-muted transition-colors duration-150 hover:text-danger"
          data-testid={`${testid}-clear`}
        >
          <X size={12} strokeWidth={2.5} aria-hidden="true" />
        </button>
      ) : null}
      <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </span>
  );
}

/** Kredit/Barter word-toggle (components.md): h32 desktop, h40 @390. */
function PriceToggle({
  pressed,
  onToggle,
  testid,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  testid: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-control border px-3 text-[12.5px] transition-colors duration-150 focus:outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 max-sm:min-h-10 ${
        pressed
          ? "border-primary bg-primary-tint font-semibold text-primary-hover"
          : "border-line-strong bg-raised font-medium text-[#3D4148] hover:border-primary hover:text-primary"
      }`}
      data-testid={testid}
    >
      {pressed ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Condition toggle: same recipe at standard control height (h40/h44). */
function ConditionToggle({
  pressed,
  onToggle,
  testid,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  testid: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border px-3 text-[12.5px] transition-colors duration-150 focus:outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 max-sm:min-h-11 ${
        pressed
          ? "border-primary bg-primary-tint font-semibold text-primary-hover"
          : "border-line-strong bg-raised font-medium text-[#3D4148] hover:border-primary hover:text-primary"
      }`}
      data-testid={testid}
    >
      {pressed ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Price field: standard geometry + Min/Maks prefix, AZN suffix, Condensed value. */
function PriceField({
  prefix,
  placeholder,
  value,
  onChange,
  ariaLabel,
  testid,
}: {
  /** Short muted prefix shown when filled ("Min"/"Maks"). */
  prefix: string;
  /** Full-word placeholder per the approved spine ("Minimum"/"Maksimum"). */
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  testid: string;
}) {
  const filled = value !== "";
  return (
    <span className="relative block">
      {filled ? (
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-muted">
          {prefix}
        </span>
      ) : null}
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={groupThousands(value)}
        onChange={(e) => onChange(digits(e.target.value))}
        className={`${control} pr-10 ${filled ? "pl-12 font-condensed text-[14px] font-semibold" : ""}`}
        data-testid={testid}
      />
      <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted">
        AZN
      </span>
    </span>
  );
}

/** Server-loaded reference data for the advanced zone. */
export interface HomeAdvancedCatalog {
  cities: CityDto[];
  /** Authoritative year options, newest first (server-computed). */
  years: number[];
  /** Reference options per category per group (existing catalog scoping). */
  optionsByCategory: Record<string, Record<string, ReferenceOptionDto[]>>;
}

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
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [mileage, setMileage] = useState("");
  const [credit, setCredit] = useState(false);
  const [barter, setBarter] = useState(false);
  const [noAccident, setNoAccident] = useState(false);
  const [notRepainted, setNotRepainted] = useState(false);
  const [collapsedCount, setCollapsedCount] = useState(0);
  const [clearCount, setClearCount] = useState(0); // remounts uncontrolled fields on Təmizlə
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
    const scalar = ["city_id", "year_min", "year_max", "engine_cc_min", "engine_cc_max",
      "body_type_id", "drive_type_id", "motorcycle_type_id"] as const;
    for (const key of scalar) {
      const value = String(data.get(key) ?? "").trim();
      if (value.length > 0) next[key] = value;
    }
    if (mileage !== "") next.mileage_max = mileage;
    const minMinor = aznInputToMinor(priceMin);
    if (minMinor !== null) next.price_min = minMinor;
    const maxMinor = aznInputToMinor(priceMax);
    if (maxMinor !== null) next.price_max = maxMinor;
    for (const key of ["fuel_type_ids", "transmission_ids", "color_ids"] as const) {
      const values = data.getAll(key).map(String).filter((v) => v.length > 0);
      if (values.length > 0) next[key] = csvFromIds(values);
    }
    // Positive claims only — unselected emits nothing.
    if (noAccident) next.no_accident = "true";
    if (notRepainted) next.not_repainted = "true";
    // Existing boolean filters (unchanged contract).
    if (credit) next.credit = "true";
    if (barter) next.barter = "true";
    router.push(searchHref(next));
  }

  /** Active-filter count for the collapsed toggle chip (derived from live form state). */
  function countActiveFilters(): number {
    let count = 0;
    const form = formRef.current;
    if (form !== null) {
      const data = new FormData(form);
      for (const key of ["city_id", "body_type_id", "drive_type_id", "motorcycle_type_id"]) {
        if (String(data.get(key) ?? "").trim() !== "") count += 1;
      }
      if (String(data.get("year_min") ?? "") !== "" || String(data.get("year_max") ?? "") !== "") count += 1;
      if (String(data.get("engine_cc_min") ?? "") !== "" || String(data.get("engine_cc_max") ?? "") !== "") count += 1;
      for (const key of ["fuel_type_ids", "transmission_ids", "color_ids"]) {
        if (data.getAll(key).length > 0) count += 1;
      }
    }
    if (mileage !== "") count += 1;
    if (priceMin !== "" || priceMax !== "") count += 1;
    if (credit) count += 1;
    if (barter) count += 1;
    if (noAccident) count += 1;
    if (notRepainted) count += 1;
    return count;
  }

  function toggleExpanded() {
    if (expanded) setCollapsedCount(countActiveFilters());
    setExpanded((v) => !v);
  }

  /** Explicit reset only (Təmizlə) — collapse never clears values. */
  function clearAll() {
    formRef.current?.reset();
    setBrandId("");
    setModelId("");
    setModels([]);
    setPriceMin("");
    setPriceMax("");
    setMileage("");
    setCredit(false);
    setBarter(false);
    setNoAccident(false);
    setNotRepainted(false);
    setClearCount((c) => c + 1);
  }

  /** "Sıfırla": resets the price group (inputs + toggles) only. */
  function resetPriceGroup() {
    setPriceMin("");
    setPriceMax("");
    setCredit(false);
    setBarter(false);
  }

  const groups = visibleFilterGroups(category);
  const options = advanced.optionsByCategory[category] ?? {};
  const priceGroupActive = priceMin !== "" || priceMax !== "" || credit || barter;
  const vehicleTypeGroup = groups.includes("BODY_TYPE") ? "BODY_TYPE" : "MOTORCYCLE_TYPE";

  const actionButtons = (
    <>
      <button
        type="submit"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-control bg-primary px-6 text-sm font-semibold tracking-[0.01em] text-white transition-colors duration-150 hover:bg-primary-hover active:bg-primary-pressed max-sm:min-h-12 sm:w-auto desk:w-full"
        data-testid="home-adv-submit"
      >
        {UI.search}
      </button>
      <button
        type="button"
        onClick={clearAll}
        className="inline-flex min-h-10 items-center justify-center rounded-control px-3 text-[13px] font-semibold text-primary transition-colors duration-150 hover:text-primary-hover"
        data-testid="home-adv-clear"
      >
        Təmizlə
      </button>
    </>
  );

  return (
    <form ref={formRef} onSubmit={submit} className="rounded-[12px] bg-raised shadow-overlay" aria-label="Elan axtarışı">
      {/* Compact core search: category · Marka · Model · Şəhər · Axtar. */}
      <div className="p-4 pb-3 md:p-5 md:pb-3">
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
        <div className="grid gap-2.5 md:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="block">
            <FieldLabel>{UI.brandLabel}</FieldLabel>
            <select className={`${control} appearance-none pr-8 min-h-12`} value={brandId} onChange={(e) => void selectBrand(e.target.value)} disabled={loadingBrands} data-testid="home-brand">
              <option value="">{UI.any}</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="block">
            <FieldLabel>{UI.modelLabel}</FieldLabel>
            <select className={`${control} appearance-none pr-8 min-h-12`} value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={brandId === ""} data-testid="home-model">
              <option value="">{UI.any}</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="block" key={`city-${clearCount}`}>
            <FieldLabel>{UI.city}</FieldLabel>
            <select name="city_id" defaultValue="" className={`${control} appearance-none pr-8 min-h-12`} data-testid="home-adv-city">
              <option value="">{UI.any}</option>
              {advanced.cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-control bg-primary px-8 text-sm font-semibold tracking-[0.01em] text-white transition-colors duration-150 hover:bg-primary-hover active:bg-primary-pressed md:w-auto"
              data-testid="home-search-submit"
            >
              {UI.search}
            </button>
          </div>
        </div>
        {/* Collapsed/expanded toggle (12.5/600 green + count chip + chevron). */}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="home-advanced-filters"
          onClick={toggleExpanded}
          className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-control text-[12.5px] font-semibold text-primary transition-colors duration-150 hover:text-primary-hover"
          data-testid="home-advanced-toggle"
        >
          Ətraflı axtarış
          {!expanded && collapsedCount > 0 ? (
            <span className="rounded-pill bg-primary-tint px-1.5 py-0.5 text-[10px] font-semibold text-primary-hover" data-testid="home-adv-count">
              {collapsedCount} filtr
            </span>
          ) : null}
          {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      </div>

      {/* Advanced zone — Direction 1C. DOM order is the mandated 1–10
          (price is SOURCE position 6); grid-template-areas place the
          price spine visually right at desk/xl and the full-width band
          at md/390 without ever reordering the DOM. */}
      <div
        id="home-advanced-filters"
        hidden={!expanded}
        data-testid="home-advanced-panel"
        className={
          "border-t border-line p-4 md:px-4 md:py-3.5 desk:px-4 desk:pt-3.5 desk:pb-4 xl:px-[18px] xl:py-4 " +
          "grid grid-cols-1 gap-y-3 " +
          "[grid-template-areas:'ban'_'mileage'_'year'_'engine'_'color'_'price'_'fuel'_'drive'_'trans'_'cond'_'actions'] " +
          "md:grid-cols-2 md:gap-x-3.5 md:gap-y-3 " +
          "md:[grid-template-areas:'ban_mileage'_'year_engine'_'color_.'_'price_price'_'fuel_drive'_'trans_cond'_'actions_actions'] " +
          "desk:grid-cols-[1fr_1fr_300px] desk:gap-x-3.5 desk:gap-y-[13px] " +
          "desk:[grid-template-areas:'ban_mileage_price'_'year_engine_price'_'color_fuel_price'_'drive_trans_price'_'cond_cond_price'] " +
          "xl:grid-cols-[1fr_1fr_1fr_340px] xl:gap-x-4 xl:gap-y-3.5 " +
          "xl:[grid-template-areas:'ban_mileage_year_price'_'engine_color_fuel_price'_'drive_trans_cond_price']"
        }
      >
        {/* 1 — Ban növü / Motosiklet növü (existing catalog contract). */}
        <div className="[grid-area:ban]">
          <FieldLabel>{GROUP_LABELS[vehicleTypeGroup]}</FieldLabel>
          <Select1C
            key={`${vehicleTypeGroup}-${clearCount}`}
            name={GROUP_TO_PARAM[vehicleTypeGroup]}
            ariaLabel={GROUP_LABELS[vehicleTypeGroup]}
            placeholder={UI.any}
            optionItems={(options[vehicleTypeGroup] ?? []).map((o) => ({ value: o.id, label: o.name }))}
            clearable
            testid={`home-adv-${GROUP_TO_PARAM[vehicleTypeGroup]}`}
          />
        </div>
        {/* 2 — Yürüş, km (manual only). */}
        <div className="[grid-area:mileage]">
          <FieldLabel>{UI.mileage}, km</FieldLabel>
          <span className="relative block">
            <input
              type="text"
              inputMode="numeric"
              placeholder="maks. 123 500"
              aria-label={`${UI.mileage} ${UI.max}`}
              value={groupThousands(mileage)}
              onChange={(e) => setMileage(digits(e.target.value))}
              className={`${control} ${mileage !== "" ? "pr-9 font-medium" : ""}`}
              data-testid="home-adv-mileage-max"
            />
            {mileage !== "" ? (
              <button
                type="button"
                aria-label="Yürüş — təmizlə"
                onClick={() => setMileage("")}
                className="absolute right-2.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center text-muted transition-colors duration-150 hover:text-danger"
              >
                <X size={12} strokeWidth={2.5} aria-hidden="true" />
              </button>
            ) : null}
          </span>
        </div>
        {/* 3 — Buraxılış ili (authoritative range). */}
        <div className="[grid-area:year]">
          <FieldLabel>{UI.year}</FieldLabel>
          <div className="grid grid-cols-2 gap-2" key={`year-${clearCount}`}>
            <Select1C name="year_min" ariaLabel="Minimum il" placeholder="Min" optionItems={advanced.years.map((y) => ({ value: String(y), label: String(y) }))} testid="home-adv-year-min" />
            <Select1C name="year_max" ariaLabel="Maximum il" placeholder="Maks" optionItems={advanced.years.map((y) => ({ value: String(y), label: String(y) }))} testid="home-adv-year-max" />
          </div>
        </div>
        {/* 4 — Mühərrikin həcmi (shared generator). */}
        <div className="[grid-area:engine]">
          <FieldLabel>{UI.engineCcTitle}</FieldLabel>
          <div className="grid grid-cols-2 gap-2" key={`engine-${clearCount}`}>
            <Select1C name="engine_cc_min" ariaLabel={`${UI.engineCcTitle} ${UI.min}`} placeholder="Min" optionItems={engineCcOptions().map((v) => ({ value: String(v), label: String(v) }))} testid="home-adv-engine-min" />
            <Select1C name="engine_cc_max" ariaLabel={`${UI.engineCcTitle} ${UI.max}`} placeholder="Maks" optionItems={engineCcOptions().map((v) => ({ value: String(v), label: String(v) }))} testid="home-adv-engine-max" />
          </div>
        </div>
        {/* 5 — Rəng (multi, swatches). */}
        <div className="[grid-area:color]">
          <MultiSelectField
            key={`COLOR-${clearCount}`}
            variant="1c"
            label={GROUP_LABELS.COLOR}
            name={GROUP_TO_PARAM.COLOR}
            options={options.COLOR ?? []}
            initialSelected={[]}
            swatches
            panelWide
            testid="home-adv-color"
          />
        </div>
        {/* 6 — Qiymət, AZN: spine at desk/xl, navy-rule band at md/390. */}
        <div
          className="[grid-area:price] rounded-r-lg border-l-[3px] border-navy bg-row-hover p-3 desk:-my-3.5 desk:flex desk:flex-col desk:rounded-none desk:border-l desk:border-line desk:bg-transparent desk:px-4 desk:py-3.5 xl:-my-4 xl:px-[18px] xl:py-4"
          data-testid="home-adv-price-block"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="rounded-[4px] bg-navy px-2 py-1 text-[10px] font-bold tracking-[0.06em] text-white">6</span>
            <span className="text-[13.5px] font-bold text-navy xl:text-[14px]">{UI.price}, AZN</span>
            {priceGroupActive ? (
              <button
                type="button"
                onClick={resetPriceGroup}
                className="ml-auto inline-flex min-h-8 items-center text-[11px] font-semibold text-primary transition-colors duration-150 hover:text-primary-hover"
                data-testid="home-adv-price-reset"
              >
                Sıfırla
              </button>
            ) : null}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2 desk:grid-cols-1">
            <PriceField prefix="Min" placeholder="Minimum" value={priceMin} onChange={setPriceMin} ariaLabel={`${UI.price} ${UI.min}`} testid="home-adv-price-min" />
            <PriceField prefix="Maks" placeholder="Maksimum" value={priceMax} onChange={setPriceMax} ariaLabel={`${UI.price} ${UI.max}`} testid="home-adv-price-max" />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <PriceToggle pressed={credit} onToggle={() => setCredit((v) => !v)} testid="home-adv-credit">
              Kredit mümkündür
            </PriceToggle>
            <PriceToggle pressed={barter} onToggle={() => setBarter((v) => !v)} testid="home-adv-barter">
              {UI.barter}
            </PriceToggle>
          </div>
          <p className="mt-2.5 hidden text-[11px] leading-relaxed text-muted desk:block">Kredit və Barter qiymətə aiddir.</p>
          {/* Actions live in the spine at desk+ (anchored to its foot). */}
          <div className="mt-auto hidden flex-col items-stretch gap-2 pt-3.5 text-center desk:flex">{actionButtons}</div>
        </div>
        {/* 7 — Yanacaq növü (multi). */}
        <div className="[grid-area:fuel]">
          <MultiSelectField
            key={`FUEL_TYPE-${clearCount}`}
            variant="1c"
            label="Yanacaq növü"
            name={GROUP_TO_PARAM.FUEL_TYPE}
            options={options.FUEL_TYPE ?? []}
            initialSelected={[]}
            testid="home-adv-fuel_type"
          />
        </div>
        {/* 8 — Ötürücü (CAR only; existing drive-type contract). */}
        {groups.includes("DRIVE_TYPE") ? (
          <div className="[grid-area:drive]">
            <FieldLabel>{GROUP_LABELS.DRIVE_TYPE}</FieldLabel>
            <Select1C
              key={`DRIVE_TYPE-${clearCount}`}
              name={GROUP_TO_PARAM.DRIVE_TYPE}
              ariaLabel={GROUP_LABELS.DRIVE_TYPE}
              placeholder={UI.any}
              optionItems={(options.DRIVE_TYPE ?? []).map((o) => ({ value: o.id, label: o.name }))}
              clearable
              testid={`home-adv-${GROUP_TO_PARAM.DRIVE_TYPE}`}
            />
          </div>
        ) : null}
        {/* 9 — Sürətlər qutusu (multi). */}
        <div className="[grid-area:trans]">
          <MultiSelectField
            key={`TRANSMISSION-${clearCount}`}
            variant="1c"
            label={GROUP_LABELS.TRANSMISSION}
            name={GROUP_TO_PARAM.TRANSMISSION}
            options={options.TRANSMISSION ?? []}
            initialSelected={[]}
            testid="home-adv-transmission"
          />
        </div>
        {/* 10 — Avtomobil vəziyyəti: visible toggle pair, final block. */}
        <div className="[grid-area:cond]">
          <FieldLabel>{UI.conditionTitle}</FieldLabel>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <ConditionToggle pressed={noAccident} onToggle={() => setNoAccident((v) => !v)} testid="home-adv-no-accident">
              {UI.noAccident}
            </ConditionToggle>
            <ConditionToggle pressed={notRepainted} onToggle={() => setNotRepainted((v) => !v)} testid="home-adv-not-repainted">
              {UI.notRepainted}
            </ConditionToggle>
          </div>
        </div>
        {/* Actions in flow below desk (right-aligned @768, stacked @390). */}
        <div className="[grid-area:actions] mt-1 flex flex-col gap-2 border-t border-sunken pt-3 sm:flex-row-reverse sm:items-center sm:justify-start sm:gap-2.5 desk:hidden">
          {actionButtons}
        </div>
      </div>
    </form>
  );
}
