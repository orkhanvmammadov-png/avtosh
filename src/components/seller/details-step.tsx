"use client";

import { aznInputToMinor, minorToAznInput } from "@/lib/format";
import { SELLER } from "@/lib/marketplace/labels";
import type { ListingEditor } from "@/components/seller/use-listing-editor";
import { OPTION_GROUPS, type WizardCatalog } from "@/components/seller/use-wizard-catalog";
import { CheckboxField, DeferredInput, SelectField } from "@/components/seller/wizard-fields";

/**
 * Step 2 — price/mileage/city, category-scoped option groups (only
 * groups the catalog actually returns for this category render),
 * credit/barter, features. AZN is converted to minor units at this
 * boundary — integers only.
 */
export function DetailsStep({ editor, catalog }: { editor: ListingEditor; catalog: WizardCatalog }) {
  const { dto } = editor;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <DeferredInput
          id="wizard-price"
          label={SELLER.price}
          inputMode="numeric"
          placeholder="15000"
          initialValue={dto.priceMinor === null ? "" : minorToAznInput(String(dto.priceMinor))}
          onValue={(value) => {
            if (value.trim() === "") {
              editor.patch({ price_minor: null });
              return;
            }
            const minor = aznInputToMinor(value);
            if (minor !== null) {
              editor.patch({ price_minor: Number(minor) });
            }
          }}
        />
        <DeferredInput
          id="wizard-mileage"
          label={SELLER.mileage}
          inputMode="numeric"
          placeholder="120000"
          initialValue={dto.mileage === null ? "" : String(dto.mileage)}
          onValue={(value) => {
            const digits = value.trim().replace(/\s+/g, "");
            editor.patch({ mileage: /^\d{1,7}$/.test(digits) ? Number(digits) : null });
          }}
        />
        <DeferredInput
          id="wizard-engine"
          label={SELLER.engineCc}
          inputMode="numeric"
          placeholder="1998"
          initialValue={dto.engineCc === null ? "" : String(dto.engineCc)}
          onValue={(value) => {
            const digits = value.trim();
            editor.patch({ engine_cc: /^\d{1,6}$/.test(digits) ? Number(digits) : null });
          }}
        />
        <SelectField
          id="wizard-city"
          label={SELLER.city}
          value={dto.cityId}
          placeholder={SELLER.select}
          items={catalog.cities}
          onChange={(id) => editor.patch({ city_id: id }, { immediate: true })}
        />
        {OPTION_GROUPS.filter((g) => (catalog.options[g.group] ?? []).length > 0).map((g) => (
          <SelectField
            key={g.group}
            id={`wizard-${g.field}`}
            label={g.label}
            value={dto[g.dtoKey]}
            placeholder={SELLER.select}
            items={catalog.options[g.group] ?? []}
            onChange={(id) => editor.patch({ [g.field]: id }, { immediate: true })}
          />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CheckboxField
          id="wizard-credit"
          label={SELLER.credit}
          checked={dto.creditAvailable}
          onChange={(checked) => editor.patch({ credit_available: checked }, { immediate: true })}
        />
        <CheckboxField
          id="wizard-barter"
          label={SELLER.barter}
          checked={dto.barterAvailable}
          onChange={(checked) => editor.patch({ barter_available: checked }, { immediate: true })}
        />
      </div>
      {catalog.features.length > 0 ? (
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-slate-strong">{SELLER.features}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="wizard-features">
            {catalog.features.map((feature) => {
              const checked = dto.featureIds.includes(feature.id);
              return (
                <CheckboxField
                  key={feature.id}
                  id={`wizard-feature-${feature.id}`}
                  label={feature.name}
                  checked={checked}
                  onChange={(next) => {
                    const ids = next
                      ? [...dto.featureIds, feature.id]
                      : dto.featureIds.filter((id) => id !== feature.id);
                    editor.patch({ feature_ids: ids }, { immediate: true });
                  }}
                />
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
