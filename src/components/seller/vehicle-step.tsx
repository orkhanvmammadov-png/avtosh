"use client";

import { SELLER } from "@/lib/marketplace/labels";
import type { ListingEditor } from "@/components/seller/use-listing-editor";
import type { WizardCatalog } from "@/components/seller/use-wizard-catalog";
import { DeferredInput, SelectField } from "@/components/seller/wizard-fields";

/**
 * Step 1 — category / brand / model / year. Selects are controlled by
 * the SERVER DTO: after a category or brand change the PATCH response
 * (with its dependent-field clearing) is the single source of truth.
 */
export function VehicleStep({ editor, catalog }: { editor: ListingEditor; catalog: WizardCatalog }) {
  const { dto } = editor;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        id="wizard-category"
        label={SELLER.category}
        value={dto.category}
        placeholder={SELLER.select}
        items={catalog.categories}
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
      <DeferredInput
        id="wizard-year"
        label={SELLER.year}
        inputMode="numeric"
        placeholder="2020"
        maxLength={4}
        initialValue={dto.year === null ? "" : String(dto.year)}
        onValue={(value) => {
          const year = /^\d{4}$/.test(value.trim()) ? Number(value.trim()) : null;
          editor.patch({ year });
        }}
      />
    </div>
  );
}
