"use client";

import { useMemo, useState } from "react";
import type { CatalogItem } from "@/components/seller/use-wizard-catalog";
import type { ListingEditor } from "@/components/seller/use-listing-editor";
import { EquipmentPicker } from "@/components/seller/axin/equipment-picker";
import { applySelectionOps } from "@/lib/marketplace/equipment";
import { SELLER } from "@/lib/marketplace/labels";

const EMPTY_OPS: ReadonlyMap<string, boolean> = new Map();

/**
 * O.11 seller equipment selector (4a — O.11 EQUIPMENT CATALOG UX):
 * outer Təchizat disclosure with an honest selected summary; the open
 * state renders the shared EquipmentPicker core (search + the seven
 * approved accordion groups). Selection stays UUID-backed through the
 * existing draft editor PATCH; search typing and accordion toggling
 * never write to the draft.
 *
 * RAPID MULTI-SELECT (O.11.5B-C1): the server-DTO checkbox value lags
 * one round-trip, so clicks faster than a save must not derive the
 * next feature_ids from stale dto.featureIds. Every toggle appends to
 * an intent log (id → desired state); display AND every PATCH value
 * are dto.featureIds + the FULL log, which is correct under any
 * staleness, and the serialized editor chain guarantees the last
 * response carries the final array (no out-of-order responses exist).
 * Once the editor settles (saved / error / conflict) the log is
 * dropped and the server DTO is truth again — a failed PATCH therefore
 * rolls the checkboxes back through the existing error model.
 */
export function EquipmentSelector({ editor, features }: { editor: ListingEditor; features: CatalogItem[] }) {
  const { dto } = editor;
  const [open, setOpen] = useState(false);
  // Selection intent log since the last editor settle (see header).
  const [ops, setOps] = useState<ReadonlyMap<string, boolean>>(EMPTY_OPS);

  // Reconcile: once nothing is dirty/saving, the adopted server DTO is
  // the complete truth (it reflects every sent intent — or, on save
  // error/conflict, the state the seller must honestly see), so the
  // log is redundant and any external change (category pruning,
  // conflict reload) must win. Render-time adjustment — guarded, so it
  // converges immediately; never runs while a save is in flight.
  if (ops !== EMPTY_OPS && !editor.dirty) {
    setOps(EMPTY_OPS);
  }

  const selectedIds = useMemo(() => applySelectionOps(dto.featureIds, ops), [dto.featureIds, ops]);

  function toggleFeature(id: string, checked: boolean) {
    const nextOps = new Map(ops).set(id, checked);
    setOps(nextOps);
    // NEVER an absolute list from stale render state: base + full log
    // is correct whatever dto snapshot this render happens to hold.
    editor.patch({ feature_ids: applySelectionOps(dto.featureIds, nextOps) }, { immediate: true });
  }

  if (features.length === 0) return null;

  const total = selectedIds.length;

  return (
    <fieldset>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="wizard-features-toggle"
        className="flex h-10 w-full items-center justify-between rounded-control border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-muted"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">{SELLER.features}</span>
          <span
            className={`truncate text-[12.5px] ${total > 0 ? "font-semibold text-primary" : "font-normal text-muted"}`}
            data-testid="equipment-summary"
          >
            {total > 0 ? `${total} ${SELLER.equipmentSelectedWord}` : SELLER.equipmentNoneSelected}
          </span>
        </span>
        <span aria-hidden="true" className="text-muted">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open ? (
        <div className="mt-2">
          <EquipmentPicker features={features} selectedIds={selectedIds} onToggle={toggleFeature} />
        </div>
      ) : null}
    </fieldset>
  );
}
