"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { LISTING_YEAR_MIN, listingYearMax } from "@/lib/config/marketplace";
import { SELLER } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import { createListing, patchListing } from "@/lib/seller/owner-api";
import { SellerListboxField } from "@/components/seller/listbox-field";
import { TypeaheadField, type TypeaheadItem } from "@/components/seller/axin/typeahead-field";

/**
 * O.9 AXIN Quick Start (flow.md): the navy 30-second entry —
 * Kateqoriya → Marka → Model → Buraxılış ili → "Başla →". Nothing is
 * persisted while choosing; "Başla" creates the real draft through
 * the existing endpoint and PATCHes the three Quick Start values in
 * one revision-guarded request, then enters the AXIN flow. Category
 * toggles, typeahead Brand/Model with dependency, sealed year policy
 * (1900 → currentYear+1, newest first).
 */
export function QuickStartCreate({
  categories,
}: {
  categories: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [category, setCategory] = useState(categories[0]?.code ?? "CAR");
  const [brandId, setBrandId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  // Loaded lists are keyed by their request inputs so "loading" is
  // DERIVED (key mismatch), never set synchronously inside effects
  // (React Compiler rule).
  const [brandsFor, setBrandsFor] = useState<{ key: string; items: TypeaheadItem[] } | null>(null);
  const [modelsFor, setModelsFor] = useState<{ key: string; items: TypeaheadItem[] } | null>(null);
  const [variantsFor, setVariantsFor] = useState<{ key: string; items: TypeaheadItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void publicFetch<TypeaheadItem[]>(`/api/v1/catalog/brands?category=${encodeURIComponent(category)}`)
      .then((r) => {
        if (!cancelled) setBrandsFor({ key: category, items: r.data });
      })
      .catch(() => {
        if (!cancelled) setBrandsFor({ key: category, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  const modelKey = brandId === null ? null : `${category}:${brandId}`;
  useEffect(() => {
    if (modelKey === null || brandId === null) return;
    let cancelled = false;
    void publicFetch<TypeaheadItem[]>(
      `/api/v1/catalog/models?category=${encodeURIComponent(category)}&brand_id=${brandId}`,
    )
      .then((r) => {
        if (!cancelled) setModelsFor({ key: modelKey, items: r.data });
      })
      .catch(() => {
        if (!cancelled) setModelsFor({ key: modelKey, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [category, brandId, modelKey]);

  const variantKey = brandId === null || modelId === null ? null : `${category}:${brandId}:${modelId}`;
  useEffect(() => {
    if (variantKey === null || brandId === null || modelId === null) return;
    let cancelled = false;
    void publicFetch<TypeaheadItem[]>(
      `/api/v1/catalog/variants?category=${encodeURIComponent(category)}&brand_id=${brandId}&model_id=${modelId}`,
    )
      .then((r) => {
        if (!cancelled) setVariantsFor({ key: variantKey, items: r.data });
      })
      .catch(() => {
        if (!cancelled) setVariantsFor({ key: variantKey, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [category, brandId, modelId, variantKey]);

  const brands = brandsFor?.key === category ? brandsFor.items : [];
  const brandsLoading = brandsFor?.key !== category;
  const models = modelKey !== null && modelsFor?.key === modelKey ? modelsFor.items : [];
  const variants = variantKey !== null && variantsFor?.key === variantKey ? variantsFor.items : [];
  const variantsLoading = variantKey !== null && variantsFor?.key !== variantKey;
  const modelsLoading = modelKey !== null && modelsFor?.key !== modelKey;

  const yearOptions = useMemo(() => {
    const yearMax = listingYearMax();
    return Array.from({ length: yearMax - LISTING_YEAR_MIN + 1 }, (_, i) => {
      const y = yearMax - i;
      return { value: y, label: String(y) };
    });
  }, []);

  const complete =
    brandId !== null &&
    modelId !== null &&
    year !== null &&
    // Owner rule: a CAR family with active Alt models requires one.
    (category !== "CAR" || variantsLoading || variants.length === 0 || variantId !== null);

  async function start() {
    if (busy || !complete) return;
    setBusy(true);
    setError(false);
    try {
      const listing = await createListing(category);
      await patchListing(listing.id, listing.revision, {
        brand_id: brandId,
        model_id: modelId,
        model_variant_id: variantId,
        year,
      });
      router.push(`/elan-yerlesdir/${listing.id}`);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-[12px] border border-[#2B3644] bg-[#1D2733] p-4 text-white"
      data-testid="quick-start"
    >
      <h2 className="text-[15px] font-bold tracking-[-0.01em]">{SELLER.quickStartTitle}</h2>
      <fieldset className="mt-3">
        <legend className="mb-1.5 block text-xs font-medium text-white/70">{SELLER.chooseCategory}</legend>
        <div className="flex gap-2">
          {categories.map((item) => {
            const selected = category === item.code;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                data-testid={`quick-start-category-${item.code}`}
                onClick={() => {
                  if (item.code === category) return;
                  setCategory(item.code);
                  setBrandId(null);
                  setModelId(null);
                  setVariantId(null);
                }}
                className={`inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-control border text-[13px] font-semibold transition-colors duration-150 ${
                  selected
                    ? "border-[#147A4E] bg-[#E7F2EC] text-[#147A4E]"
                    : "border-[#3A4552] bg-transparent text-white/85 hover:border-white/50"
                }`}
              >
                {selected ? <Check size={14} aria-hidden="true" /> : null}
                {item.name}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="mt-3 grid gap-x-3 gap-y-3 desk:grid-cols-2 [&_label]:!text-white/70">
        <TypeaheadField
          id="quick-start-brand"
          label={SELLER.brand}
          value={brandId}
          items={brands}
          loading={brandsLoading}
          onChange={(id) => {
            setBrandId(id);
            setModelId(null); // stale model never survives a brand change
            setVariantId(null);
          }}
        />
        <TypeaheadField
          id="quick-start-model"
          label={SELLER.model}
          value={modelId}
          items={models}
          disabled={brandId === null}
          disabledHint={SELLER.brandFirstHint}
          loading={modelsLoading}
          onChange={(id) => {
            setModelId(id);
            setVariantId(null); // stale Alt model never survives a model change
          }}
        />
        {modelId !== null && (variantsLoading || variants.length > 0) ? (
          <TypeaheadField
            id="quick-start-model-variant"
            label={SELLER.modelVariant}
            value={variantId}
            items={variants}
            loading={variantsLoading}
            onChange={setVariantId}
          />
        ) : null}
        <div className="desk:col-span-2 [&_button]:bg-raised">
          <SellerListboxField
            id="quick-start-year"
            label={SELLER.year}
            value={year}
            placeholder={SELLER.select}
            options={yearOptions}
            onChange={(value) => setYear(value === null ? null : Number(value))}
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#F2B8B5]">
          Elan yaradılmadı. Yenidən cəhd edin.
        </p>
      ) : null}
      <button
        type="button"
        disabled={!complete || busy}
        onClick={() => void start()}
        data-testid="quick-start-begin"
        className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-control bg-primary text-sm font-bold text-white transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? SELLER.saving : SELLER.quickStartStart}
      </button>
    </div>
  );
}
