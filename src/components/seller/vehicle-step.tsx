"use client";

import { useMemo } from "react";
import { LISTING_YEAR_MIN, listingYearMax } from "@/lib/config/marketplace";
import { SELLER } from "@/lib/marketplace/labels";
import type { ListingEditor } from "@/components/seller/use-listing-editor";
import type { WizardCatalog } from "@/components/seller/use-wizard-catalog";
import { SellerListboxField } from "@/components/seller/listbox-field";
import { SelectField } from "@/components/seller/wizard-fields";

/**
 * Step 1 — category / brand / model / year. Selects are controlled by
 * the SERVER DTO: after a category or brand change the PATCH response
 * (with its dependent-field clearing) is the single source of truth.
 */
export function VehicleStep({ editor, catalog }: { editor: ListingEditor; catalog: WizardCatalog }) {
  const { dto } = editor;
  // Authoritative year policy (O.2, reused): 1900 → currentYear+1,
  // newest first. Derived, never hard-coded.
  const yearOptions = useMemo(() => {
    const yearMax = listingYearMax();
    return Array.from({ length: yearMax - LISTING_YEAR_MIN + 1 }, (_, i) => {
      const year = yearMax - i;
      return { value: year, label: String(year) };
    });
  }, []);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        id="wizard-category"
        label={SELLER.category}
        value={dto.category}
        placeholder={SELLER.select}
        items={catalog.categories}
        valueField="code"
        onChange={(code) => {
          if (code !== null && code !== dto.category) {
            editor.patch({ category: code }, { immediate: true });
          }
        }}
      />
      <SelectField
        id="wizard-brand"
        label={SELLER.brand}
        value={dto.brandId}
        placeholder={SELLER.select}
        disabled={catalog.brands.length === 0}
        items={catalog.brands}
        onChange={(id) => editor.patch({ brand_id: id }, { immediate: true })}
      />
      <SelectField
        id="wizard-model"
        label={SELLER.model}
        value={dto.modelId}
        placeholder={SELLER.select}
        disabled={dto.brandId === null || catalog.models.length === 0}
        items={catalog.models}
        onChange={(id) => editor.patch({ model_id: id }, { immediate: true })}
      />
      <SellerListboxField
        id="wizard-year"
        label={SELLER.year}
        value={dto.year}
        placeholder={SELLER.select}
        options={yearOptions}
        onChange={(value) => editor.patch({ year: value === null ? null : Number(value) }, { immediate: true })}
      />
    </div>
  );
}
