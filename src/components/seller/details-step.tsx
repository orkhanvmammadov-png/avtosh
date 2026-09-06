"use client";

import { useMemo } from "react";
import { aznInputToMinor, minorToAznInput } from "@/lib/format";
import { engineCcOptions } from "@/lib/marketplace/engine-options";
import { SELLER } from "@/lib/marketplace/labels";
import type { ListingEditor } from "@/components/seller/use-listing-editor";
import { OPTION_GROUPS, type WizardCatalog } from "@/components/seller/use-wizard-catalog";
import { SellerListboxField } from "@/components/seller/listbox-field";
import { CheckboxField, DeferredCheckbox, DeferredInput, SelectField } from "@/components/seller/wizard-fields";

/** Thousands-spaced display label; the persisted value stays numeric. */
function formatCc(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Step 2 — price/mileage/city, category-scoped option groups (only
 * groups the catalog actually returns for this category render),
 * credit/barter, features. AZN is converted to minor units at this
 * boundary — integers only.
 */
export function DetailsStep({ editor, catalog }: { editor: ListingEditor; catalog: WizardCatalog }) {
  const { dto } = editor;
  // Approved O.2 sequence (literal 0 is a real value). LEGACY
  // COMPATIBILITY: a persisted engine_cc outside the sequence (server
  // accepts 0–100000) is injected at its sorted position as a
  // temporary current option — displayed literally, never rounded,
  // normalized, or erased; it drops out only after the seller
  // deliberately picks a standard value.
  const engineOptions = useMemo(() => {
    const values = engineCcOptions();
    if (dto.engineCc !== null && !values.includes(dto.engineCc)) {
      const at = values.findIndex((v) => v > dto.engineCc!);
      if (at === -1) values.push(dto.engineCc);
      else values.splice(at, 0, dto.engineCc);
    }
    return values.map((v) => ({ value: v, label: formatCc(v) }));
  }, [dto.engineCc]);
  const colorGroup = OPTION_GROUPS.find((g) => g.group === "COLOR");
  const colorOptions = useMemo(
    () =>
      (catalog.options.COLOR ?? []).map((o) => ({
        value: o.id,
        label: o.name,
        code: o.code,
        swatch: o.swatch ?? null,
      })),
    [catalog.options],
  );
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
        <SellerListboxField
          id="wizard-engine"
          label={SELLER.engineCc}
          value={dto.engineCc}
          placeholder={SELLER.select}
          options={engineOptions}
          onChange={(value) => editor.patch({ engine_cc: value === null ? null : Number(value) }, { immediate: true })}
        />
        <SelectField
          id="wizard-city"
          label={SELLER.city}
          value={dto.cityId}
          placeholder={SELLER.select}
          items={catalog.cities}
          onChange={(id) => editor.patch({ city_id: id }, { immediate: true })}
        />
        {OPTION_GROUPS.filter((g) => g.group !== "COLOR" && (catalog.options[g.group] ?? []).length > 0).map((g) => (
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
        {colorGroup !== undefined && colorOptions.length > 0 ? (
          <SellerListboxField
            id="wizard-color_id"
            label={colorGroup.label}
            value={dto.colorId}
            placeholder="Rəng seçin"
            options={colorOptions}
            swatches
            onChange={(id) => editor.patch({ color_id: id === null ? null : String(id) }, { immediate: true })}
          />
        ) : null}
      </div>
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-slate-strong">{SELLER.conditionTitle}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <DeferredCheckbox
            id="wizard-no-accident"
            label={SELLER.noAccident}
            initialChecked={dto.noAccident === true}
            onValue={(checked) => editor.patch({ no_accident: checked ? true : null }, { immediate: true })}
          />
          <DeferredCheckbox
            id="wizard-not-repainted"
            label={SELLER.notRepainted}
            initialChecked={dto.notRepainted === true}
            onValue={(checked) => editor.patch({ not_repainted: checked ? true : null }, { immediate: true })}
          />
        </div>
      </fieldset>
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
