"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABELS, UI } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import { searchHref } from "@/lib/marketplace/search-params";
import type { BrandDto, CategoryDto, ModelDto } from "@/services/catalog";

const selectClass =
  "mt-1.5 block min-h-12 w-full rounded-control border border-line-strong bg-raised px-3 text-sm text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none disabled:bg-sunken disabled:text-muted";

/** Hero search: category → brands → models, navigating to /elanlar with URL params. */
export function HomeSearch({ categories, initialBrands }: { categories: CategoryDto[]; initialBrands: BrandDto[] }) {
  const router = useRouter();
  const [category, setCategory] = useState(categories[0]?.code ?? "CAR");
  const [brands, setBrands] = useState<BrandDto[]>(initialBrands);
  const [models, setModels] = useState<ModelDto[]>([]);
  const [brandId, setBrandId] = useState("");
  const [modelId, setModelId] = useState("");
  const [loadingBrands, setLoadingBrands] = useState(false);
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

  function submit(event: FormEvent) {
    event.preventDefault();
    router.push(searchHref({ category, ...(brandId ? { brand_id: brandId } : {}), ...(modelId ? { model_id: modelId } : {}) }));
  }

  return (
    <form onSubmit={submit} className="rounded-[12px] bg-raised p-4 shadow-overlay md:p-5" aria-label="Elan axtarışı">
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
    </form>
  );
}
