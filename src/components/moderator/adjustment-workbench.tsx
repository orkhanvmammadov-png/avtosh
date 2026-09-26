"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EquipmentPicker } from "@/components/seller/axin/equipment-picker";
import { ModerationActions } from "@/components/moderator/moderation-actions";
import { ModeratorPhotoPlan, type PhotoPlanItem } from "@/components/moderator/photo-plan";
import { OPTION_GROUPS, useWizardCatalog, type CatalogItem } from "@/components/seller/use-wizard-catalog";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { formatDateAz, formatMileage, formatPriceMinor, formatTimeAz } from "@/lib/format";
import { STAFF } from "@/lib/marketplace/labels";
import { publicFetch, PublicApiError } from "@/lib/marketplace/public-api";
import type { AdjustmentDto } from "@/services/moderation-adjustments";

/**
 * O.13 Stage B — moderator adjustment workbench. Owns the edit-mode
 * state machine over the server-authoritative payload: review (with
 * saved-adjustment summary / takeover attribution) ↔ explicit edit
 * mode (Redaktə et) with Yadda saxla / Dəyişiklikləri ləğv et. The
 * server re-validates everything; this component only sequences
 * requests and renders the approved safe states. Decisions stay
 * LOCKED while an adjustment exists or the editor is open (Stage B
 * decision-safety — adjusted decisions arrive in Stage C/D).
 */

export interface AdjustmentSubject {
  type: "NEW_LISTING" | "LISTING_EDIT";
  listingRevision: number;
  editRevisionId: string | null;
  editRevisionNo: number | null;
}

export interface AdjustmentBaseImage {
  sourceId: string;
  url: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

interface WorkingContent {
  category: string;
  brand_id: string | null;
  model_id: string | null;
  model_variant_id: string | null;
  year: number | null;
  price_minor: number | null;
  mileage: number | null;
  engine_cc: number | null;
  fuel_type_id: string | null;
  transmission_id: string | null;
  body_type_id: string | null;
  drive_type_id: string | null;
  motorcycle_type_id: string | null;
  color_id: string | null;
  city_id: string | null;
  credit_available: boolean;
  barter_available: boolean;
  no_accident: true | null;
  not_repainted: true | null;
  description: string | null;
  contact_phone: string | null;
  seller_name: string | null;
  feature_ids: string[];
}

function str(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function num(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === "number" ? value : null;
}

function toWorking(data: Record<string, unknown>): WorkingContent {
  return {
    category: str(data, "category") ?? "CAR",
    brand_id: str(data, "brand_id"),
    model_id: str(data, "model_id"),
    model_variant_id: str(data, "model_variant_id"),
    year: num(data, "year"),
    price_minor: num(data, "price_minor"),
    mileage: num(data, "mileage"),
    engine_cc: num(data, "engine_cc"),
    fuel_type_id: str(data, "fuel_type_id"),
    transmission_id: str(data, "transmission_id"),
    body_type_id: str(data, "body_type_id"),
    drive_type_id: str(data, "drive_type_id"),
    motorcycle_type_id: str(data, "motorcycle_type_id"),
    color_id: str(data, "color_id"),
    city_id: str(data, "city_id"),
    credit_available: data.credit_available === true,
    barter_available: data.barter_available === true,
    no_accident: data.no_accident === true ? true : null,
    not_repainted: data.not_repainted === true ? true : null,
    description: str(data, "description"),
    contact_phone: str(data, "contact_phone"),
    seller_name: str(data, "seller_name"),
    feature_ids: Array.isArray(data.feature_ids)
      ? data.feature_ids.filter((id): id is string => typeof id === "string")
      : [],
  };
}

/** Approved field labels (same keys as the diff read models). */
const FIELD_LABELS: Record<string, string> = {
  category: "Kateqoriya",
  brand: "Marka",
  model: "Model",
  model_variant: "Alt model",
  year: "Buraxılış ili",
  price: "Qiymət",
  mileage: "Yürüş",
  engine_cc: "Mühərrik",
  fuel_type: "Yanacaq",
  transmission: "Sürətlər qutusu",
  body_type: "Ban növü",
  drive_type: "Ötürücü",
  motorcycle_type: "Moto növü",
  color: "Rəng",
  city: "Şəhər",
  credit: "Kredit",
  barter: "Barter",
  no_accident: "Vuruğu yoxdur",
  not_repainted: "Rənglənməyib",
  description: "Təsvir",
  seller_name: "Satıcının adı (elanda)",
  contact_phone: "Əlaqə nömrəsi",
};

function formatDateTime(iso: string): string {
  return `${formatDateAz(iso)} ${formatTimeAz(iso)}`;
}

// --- shared small UI --------------------------------------------------------

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The ONE Stage B modal primitive (sealed accessibility contract):
 * semantic role=dialog + aria-modal, initial focus inside, a real
 * focus trap (Tab and Shift+Tab cycle within; a document-level capture
 * listener means focus can never Tab into the background), Escape as
 * safe cancellation (`onClose` — every Stage B dialog has a
 * non-destructive cancel path), and focus return to the triggering
 * control on close. No second bespoke trap exists.
 */
function Dialog({
  title,
  body,
  onClose,
  children,
  testId,
}: {
  title: string;
  body: string;
  /** Safe cancellation (Escape / the dialog's cancel action). */
  onClose: () => void;
  children: ReactNode;
  testId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && container.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" data-testid={testId}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-staff bg-raised p-5 shadow-xl"
      >
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-strong">{body}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">{children}</div>
      </div>
    </div>
  );
}

// --- saved-state summary ----------------------------------------------------

function AdjustmentSummary({ adjustment }: { adjustment: AdjustmentDto }) {
  const hasFieldChanges =
    adjustment.changes.length > 0 ||
    adjustment.descriptionChange !== null ||
    adjustment.equipmentAdded.length > 0 ||
    adjustment.equipmentRemoved.length > 0;
  const photo = adjustment.photoSummary;
  const hasPhotoChanges = photo.removedCount > 0 || photo.primaryChanged || photo.reordered;
  return (
    <section
      aria-label={STAFF.layerModerator}
      className="rounded-staff border border-line bg-raised p-4"
      data-testid="adjustment-summary"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-staff bg-info-soft px-2 py-0.5 text-xs font-semibold text-info" data-testid="adjustment-chip">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          {STAFF.adjSaved}
        </span>
        <span className="text-xs text-muted" data-testid="adjustment-attribution">
          {STAFF.adjSavedBy}: {adjustment.savedBy.displayName ?? "—"} · {formatDateTime(adjustment.savedAt)}
        </span>
      </div>
      {hasFieldChanges ? (
        <dl className="mt-3 space-y-1.5" data-testid="adjustment-changes">
          {adjustment.changes.map((change) => (
            <div
              key={change.field}
              className="grid grid-cols-1 gap-1 border-b border-line py-1.5 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
              data-testid={`adjustment-change-${change.field}`}
            >
              <dt className="text-slate-strong">{FIELD_LABELS[change.field] ?? change.field}</dt>
              <dd className="flex flex-wrap items-baseline gap-2 sm:justify-end sm:text-right">
                <span className="text-muted line-through">Satıcı: {change.submittedValue ?? "—"}</span>
                <span aria-hidden="true" className="text-muted">→</span>
                <span className="rounded-[4px] bg-success-soft px-1.5 py-0.5 font-semibold text-success">
                  Moderator: {change.adjustedValue ?? "—"}
                </span>
              </dd>
            </div>
          ))}
          {adjustment.equipmentAdded.length > 0 ? (
            <p className="py-1 text-sm text-success" data-testid="adjustment-equipment-added">
              <span className="font-semibold">Təchizat — {STAFF.diffAdded}:</span>{" "}
              {adjustment.equipmentAdded.map((name) => `+ ${name}`).join(" · ")}
            </p>
          ) : null}
          {adjustment.equipmentRemoved.length > 0 ? (
            <p className="py-1 text-sm text-danger" data-testid="adjustment-equipment-removed">
              <span className="font-semibold">Təchizat — {STAFF.diffRemoved}:</span>{" "}
              {adjustment.equipmentRemoved.map((name) => `− ${name}`).join(" · ")}
            </p>
          ) : null}
        </dl>
      ) : null}
      {adjustment.descriptionChange !== null ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2" data-testid="adjustment-description-diff">
          <div className="rounded-staff bg-sunken p-3">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-strong">
              Satıcı
            </h4>
            <p
              className="mt-1 max-h-40 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-ink"
              data-testid="adjustment-description-before"
            >
              {adjustment.descriptionChange.submitted ?? "—"}
            </p>
          </div>
          <div className="rounded-staff bg-success-soft p-3">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-success">
              Moderator
            </h4>
            <p
              className="mt-1 max-h-40 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-ink"
              data-testid="adjustment-description-after"
            >
              {adjustment.descriptionChange.adjusted ?? "—"}
            </p>
          </div>
        </div>
      ) : null}
      {hasPhotoChanges ? (
        <p className="mt-2 text-xs text-slate-strong" data-testid="adjustment-photo-summary">
          {STAFF.images}:{" "}
          {[
            photo.removedCount > 0 ? `${STAFF.diffRemoved} — ${photo.removedCount}` : null,
            photo.primaryChanged ? STAFF.diffNewPrimary : null,
            photo.reordered ? STAFF.diffReordered : null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
      ) : null}
      {!hasFieldChanges && !hasPhotoChanges ? (
        <p className="mt-2 text-sm text-muted">{STAFF.diffUnchanged}</p>
      ) : null}
    </section>
  );
}

// --- edit form --------------------------------------------------------------

function selectClass(): string {
  return "mt-1 min-h-11 w-full rounded-staff border border-line-strong bg-raised px-3 text-sm text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none";
}

function FieldShell({
  label,
  htmlFor,
  sellerValue,
  children,
}: {
  label: string;
  htmlFor: string;
  /** Per-field evidence helper (03-new-adjustment): shown when the
      working value diverges from the frozen submission. */
  sellerValue: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs font-medium text-slate-strong" htmlFor={htmlFor}>
      {label}
      {children}
      {sellerValue !== null ? (
        <span className="mt-0.5 block text-[11px] font-normal text-muted" data-testid={`seller-was-${htmlFor}`}>
          Satıcı: {sellerValue}
        </span>
      ) : null}
    </label>
  );
}

function AdjustmentEditor({
  listingId,
  subject,
  baseContent,
  baseImages,
  adjustment,
  imageMin,
  onExit,
}: {
  listingId: string;
  subject: AdjustmentSubject;
  baseContent: Record<string, unknown>;
  baseImages: AdjustmentBaseImage[];
  adjustment: AdjustmentDto | null;
  imageMin: number;
  onExit: () => void;
}) {
  const submitted = useMemo(
    () => toWorking(adjustment?.submittedData ?? baseContent),
    [adjustment, baseContent],
  );
  const initialContent = useMemo(
    () => toWorking(adjustment?.adjustedData ?? baseContent),
    [adjustment, baseContent],
  );
  const initialPlan = useMemo<PhotoPlanItem[]>(() => {
    if (adjustment !== null) {
      return [...adjustment.imagePlan]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((entry) => ({
          sourceId: entry.sourceId,
          url: entry.url,
          removed: entry.removed,
          isPrimary: entry.isPrimary,
        }));
    }
    return [...baseImages]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => ({
        sourceId: image.sourceId,
        url: image.url,
        removed: false,
        isPrimary: image.isPrimary,
      }));
  }, [adjustment, baseImages]);

  // portal convention: buttons stay disabled until hydration so a
  // click on a freshly reloaded page is never silently lost
  const hydrated = useHydrated();
  const [content, setContent] = useState<WorkingContent>(initialContent);
  const [plan, setPlan] = useState<PhotoPlanItem[]>(initialPlan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [unsavedDialog, setUnsavedDialog] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState<string | null>(null);

  const catalog = useWizardCatalog(content.category, content.brand_id, content.model_id);

  const dirty = useMemo(
    () =>
      JSON.stringify({ content, plan: plan.map((p) => ({ s: p.sourceId, r: p.removed, p: p.isPrimary })) }) !==
      JSON.stringify({
        content: initialContent,
        plan: initialPlan.map((p) => ({ s: p.sourceId, r: p.removed, p: p.isPrimary })),
      }),
    [content, plan, initialContent, initialPlan],
  );

  // §28: no silent loss on browser navigation while dirty. Our OWN
  // post-save/conflict reloads bypass the guard — the state is either
  // persisted or explicitly superseded, so prompting would be false.
  const bypassGuardRef = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      if (!bypassGuardRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function reloadBypassingGuard() {
    bypassGuardRef.current = true;
    window.location.reload();
  }

  const keptCount = plan.filter((item) => !item.removed).length;
  const belowMin = keptCount < imageMin;

  function set<K extends keyof WorkingContent>(key: K, value: WorkingContent[K]) {
    setContent((prev) => ({ ...prev, [key]: value }));
  }

  function nameOf(items: CatalogItem[], id: string | null): string | null {
    if (id === null) return null;
    return items.find((item) => item.id === id)?.name ?? null;
  }

  /** "Satıcı: <value>" evidence helper — display-resolved where the
      loaded catalog can resolve it, raw otherwise. Only when diverged. */
  function sellerWas(field: keyof WorkingContent, display: (value: WorkingContent) => string | null): string | null {
    if (JSON.stringify(content[field]) === JSON.stringify(submitted[field])) return null;
    return display(submitted) ?? "—";
  }

  function requestCategoryChange(nextCode: string) {
    if (nextCode === content.category) return;
    setCategoryDialog(nextCode);
  }

  function applyCategoryChange(nextCode: string) {
    setContent((prev) => ({
      ...prev,
      category: nextCode,
      brand_id: null,
      model_id: null,
      model_variant_id: null,
      body_type_id: null,
      motorcycle_type_id: null,
      feature_ids: [],
    }));
    setCategoryDialog(null);
  }

  async function save() {
    if (busy || belowMin) return;
    setBusy(true);
    setError(null);
    try {
      await publicFetch(`/api/v1/moderator/listings/${listingId}/adjustment`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_listing_revision: subject.listingRevision,
          ...(subject.editRevisionId !== null
            ? { edit_revision_id: subject.editRevisionId, expected_edit_revision: subject.editRevisionNo }
            : {}),
          expected_adjustment_revision: adjustment?.revision ?? null,
          content,
          image_plan: plan.map((item) => ({
            source_id: item.sourceId,
            removed: item.removed,
            is_primary: item.isPrimary,
          })),
        }),
      });
      // Portal convention: FULL document reload renders the saved
      // state (chip + attribution + summary) from server truth.
      reloadBypassingGuard();
    } catch (cause) {
      if (
        cause instanceof PublicApiError &&
        ["MODERATION_ADJUSTMENT_CONFLICT", "MODERATION_SUBJECT_CHANGED", "LISTING_REVISION_CONFLICT"].includes(cause.code)
      ) {
        setConflict(true);
      } else if (cause instanceof PublicApiError && cause.code === "MODERATION_CLAIM_REQUIRED") {
        setError(STAFF.claimRequired);
      } else if (cause instanceof PublicApiError && cause.code === "MODERATION_CLAIMED_BY_OTHER") {
        setError(STAFF.claimOther);
      } else if (cause instanceof PublicApiError && cause.code === "LISTING_INSUFFICIENT_IMAGES") {
        setError(STAFF.photoMinError);
      } else {
        setError(STAFF.actionFailed);
      }
      setBusy(false);
    }
  }

  function cancel() {
    if (dirty) {
      setUnsavedDialog(true);
    } else {
      onExit();
    }
  }

  if (conflict) {
    return (
      <div className="rounded-staff border-l-4 border-danger bg-danger-soft p-4" role="alert" data-testid="adjustment-conflict">
        <p className="font-semibold text-danger">{STAFF.conflictBody}</p>
        <Button className="mt-3" onClick={reloadBypassingGuard} data-testid="adjustment-conflict-refresh">
          {STAFF.conflictAction}
        </Button>
      </div>
    );
  }

  const moto = content.category === "MOTORCYCLE";

  return (
    <div className="space-y-4" data-testid="adjustment-editor">
      <p className="rounded-staff bg-info-soft px-3 py-2 text-xs leading-relaxed text-info" data-testid="edit-context-strip">
        {STAFF.editContextStrip}
      </p>

      <section aria-label={moto ? STAFF.secVehicleMoto : STAFF.secVehicleCar} className="rounded-staff border border-line bg-raised p-4">
        <h3 className="text-sm font-bold text-ink">{moto ? STAFF.secVehicleMoto : STAFF.secVehicleCar}</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <FieldShell label="Kateqoriya" htmlFor="adj-category" sellerValue={sellerWas("category", (v) => (v.category === "MOTORCYCLE" ? "Motosiklet" : "Avtomobil"))}>
            <select
              id="adj-category"
              data-testid="adj-category"
              className={selectClass()}
              value={content.category}
              onChange={(e) => requestCategoryChange(e.target.value)}
            >
              {catalog.categories.map((item) => (
                <option key={item.id} value={item.code ?? item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label="Marka" htmlFor="adj-brand" sellerValue={sellerWas("brand_id", (v) => nameOf(catalog.brands, v.brand_id))}>
            <select
              id="adj-brand"
              data-testid="adj-brand"
              className={selectClass()}
              value={content.brand_id ?? ""}
              onChange={(e) => {
                const value = e.target.value === "" ? null : e.target.value;
                setContent((prev) => ({ ...prev, brand_id: value, model_id: null, model_variant_id: null }));
              }}
            >
              <option value="">—</option>
              {catalog.brands.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label="Model" htmlFor="adj-model" sellerValue={sellerWas("model_id", (v) => nameOf(catalog.models, v.model_id))}>
            <select
              id="adj-model"
              data-testid="adj-model"
              className={selectClass()}
              value={content.model_id ?? ""}
              disabled={content.brand_id === null}
              onChange={(e) => {
                const value = e.target.value === "" ? null : e.target.value;
                setContent((prev) => ({ ...prev, model_id: value, model_variant_id: null }));
              }}
            >
              <option value="">—</option>
              {catalog.models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </FieldShell>
          {content.model_id !== null && catalog.variants.length > 0 ? (
            <FieldShell
              label="Alt model"
              htmlFor="adj-model-variant"
              sellerValue={sellerWas("model_variant_id", (v) => nameOf(catalog.variants, v.model_variant_id))}
            >
              <select
                id="adj-model-variant"
                data-testid="adj-model-variant"
                className={selectClass()}
                value={content.model_variant_id ?? ""}
                onChange={(e) => set("model_variant_id", e.target.value === "" ? null : e.target.value)}
              >
                <option value="">—</option>
                {catalog.variants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </FieldShell>
          ) : null}
          <FieldShell label="Buraxılış ili" htmlFor="adj-year" sellerValue={sellerWas("year", (v) => (v.year === null ? null : String(v.year)))}>
            <input
              id="adj-year"
              data-testid="adj-year"
              type="number"
              className={selectClass()}
              value={content.year ?? ""}
              onChange={(e) => set("year", e.target.value === "" ? null : Number(e.target.value))}
            />
          </FieldShell>
          <FieldShell label="Mühərrik (sm³)" htmlFor="adj-engine" sellerValue={sellerWas("engine_cc", (v) => (v.engine_cc === null ? null : `${v.engine_cc} sm³`))}>
            <input
              id="adj-engine"
              data-testid="adj-engine"
              type="number"
              className={selectClass()}
              value={content.engine_cc ?? ""}
              onChange={(e) => set("engine_cc", e.target.value === "" ? null : Number(e.target.value))}
            />
          </FieldShell>
          {OPTION_GROUPS.map((group) => {
            const options = catalog.options[group.group] ?? [];
            if (options.length === 0) return null;
            const value = content[group.field];
            return (
              <FieldShell
                key={group.group}
                label={group.label}
                htmlFor={`adj-${group.field}`}
                sellerValue={sellerWas(group.field, (v) => nameOf(options, v[group.field]))}
              >
                <select
                  id={`adj-${group.field}`}
                  data-testid={`adj-${group.field}`}
                  className={selectClass()}
                  value={value ?? ""}
                  onChange={(e) => set(group.field, e.target.value === "" ? null : e.target.value)}
                >
                  <option value="">—</option>
                  {options.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </FieldShell>
            );
          })}
        </div>
      </section>

      <section aria-label={STAFF.secSales} className="rounded-staff border border-line bg-raised p-4">
        <h3 className="text-sm font-bold text-ink">{STAFF.secSales}</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <FieldShell label="Qiymət (AZN)" htmlFor="adj-price" sellerValue={sellerWas("price_minor", (v) => (v.price_minor === null ? null : formatPriceMinor(v.price_minor)))}>
            <input
              id="adj-price"
              data-testid="adj-price"
              type="number"
              className={selectClass()}
              value={content.price_minor === null ? "" : Math.floor(content.price_minor / 100)}
              onChange={(e) => set("price_minor", e.target.value === "" ? null : Number(e.target.value) * 100)}
            />
          </FieldShell>
          <FieldShell label="Yürüş (km)" htmlFor="adj-mileage" sellerValue={sellerWas("mileage", (v) => (v.mileage === null ? null : formatMileage(v.mileage)))}>
            <input
              id="adj-mileage"
              data-testid="adj-mileage"
              type="number"
              className={selectClass()}
              value={content.mileage ?? ""}
              onChange={(e) => set("mileage", e.target.value === "" ? null : Number(e.target.value))}
            />
          </FieldShell>
          <FieldShell label="Şəhər" htmlFor="adj-city" sellerValue={sellerWas("city_id", (v) => nameOf(catalog.cities, v.city_id))}>
            <select
              id="adj-city"
              data-testid="adj-city"
              className={selectClass()}
              value={content.city_id ?? ""}
              onChange={(e) => set("city_id", e.target.value === "" ? null : e.target.value)}
            >
              <option value="">—</option>
              {catalog.cities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </FieldShell>
          <div className="grid grid-cols-2 gap-2 self-end">
            {(
              [
                ["credit_available", "Kredit", "adj-credit"],
                ["barter_available", "Barter", "adj-barter"],
              ] as const
            ).map(([key, label, id]) => (
              <label key={key} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink" htmlFor={id}>
                <input
                  id={id}
                  data-testid={id}
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={content[key]}
                  onChange={(e) => set(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </section>

      <section aria-label={STAFF.secCondition} className="rounded-staff border border-line bg-raised p-4">
        <h3 className="text-sm font-bold text-ink">{STAFF.secCondition}</h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              ["no_accident", "Vuruğu yoxdur", "adj-no-accident"],
              ["not_repainted", "Rənglənməyib", "adj-not-repainted"],
            ] as const
          ).map(([key, label, id]) => (
            <label key={key} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink" htmlFor={id}>
              <input
                id={id}
                data-testid={id}
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={content[key] === true}
                onChange={(e) => set(key, e.target.checked ? true : null)}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section aria-label={STAFF.secEquipment} className="rounded-staff border border-line bg-raised p-4" data-testid="adjustment-equipment">
        <h3 className="text-sm font-bold text-ink">{STAFF.secEquipment}</h3>
        <div className="mt-3">
          <EquipmentPicker
            features={catalog.features}
            selectedIds={content.feature_ids}
            onToggle={(id, checked) =>
              set(
                "feature_ids",
                checked ? [...content.feature_ids, id] : content.feature_ids.filter((f) => f !== id),
              )
            }
            markers={
              new Map([
                ...content.feature_ids
                  .filter((id) => !submitted.feature_ids.includes(id))
                  .map((id): [string, "added"] => [id, "added"]),
                ...submitted.feature_ids
                  .filter((id) => !content.feature_ids.includes(id))
                  .map((id): [string, "removed"] => [id, "removed"]),
              ])
            }
            idPrefix="mod-feature"
          />
        </div>
      </section>

      <section aria-label={STAFF.descriptionTitle} className="rounded-staff border border-line bg-raised p-4">
        <h3 className="text-sm font-bold text-ink">{STAFF.descriptionTitle}</h3>
        <FieldShell label="" htmlFor="adj-description" sellerValue={sellerWas("description", (v) => v.description)}>
          <textarea
            id="adj-description"
            data-testid="adj-description"
            className="mt-1 min-h-28 w-full rounded-staff border border-line-strong bg-raised px-3 py-2 text-sm text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none"
            maxLength={5000}
            value={content.description ?? ""}
            onChange={(e) => set("description", e.target.value === "" ? null : e.target.value)}
          />
        </FieldShell>
      </section>

      <section aria-label={STAFF.secSellerContact} className="rounded-staff border border-line bg-raised p-4">
        <h3 className="text-sm font-bold text-ink">{STAFF.secSellerContact}</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <FieldShell label="Satıcının adı (elanda)" htmlFor="adj-seller-name" sellerValue={sellerWas("seller_name", (v) => v.seller_name)}>
            <input
              id="adj-seller-name"
              data-testid="adj-seller-name"
              type="text"
              maxLength={100}
              className={selectClass()}
              value={content.seller_name ?? ""}
              onChange={(e) => set("seller_name", e.target.value === "" ? null : e.target.value)}
            />
          </FieldShell>
          <FieldShell label={STAFF.contactField} htmlFor="adj-contact" sellerValue={sellerWas("contact_phone", (v) => v.contact_phone)}>
            <input
              id="adj-contact"
              data-testid="adj-contact"
              type="tel"
              maxLength={32}
              className={selectClass()}
              value={content.contact_phone ?? ""}
              onChange={(e) => set("contact_phone", e.target.value === "" ? null : e.target.value)}
            />
          </FieldShell>
        </div>
      </section>

      <section aria-label={STAFF.images} className="rounded-staff border border-line bg-raised p-4">
        <h3 className="text-sm font-bold text-ink">{STAFF.images}</h3>
        <div className="mt-3">
          <ModeratorPhotoPlan items={plan} minImages={imageMin} onChange={setPlan} />
        </div>
      </section>

      {error !== null ? (
        <p role="alert" className="text-sm font-medium text-danger" data-testid="adjustment-error">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 flex flex-wrap gap-2 rounded-staff border border-line bg-raised p-3">
        <Button onClick={() => void save()} disabled={busy || belowMin || !hydrated} data-testid="adjustment-save">
          {STAFF.editSave}
        </Button>
        <Button variant="secondary" onClick={cancel} disabled={busy || !hydrated} data-testid="adjustment-cancel">
          {STAFF.editCancel}
        </Button>
      </div>

      {unsavedDialog ? (
        <Dialog
          title={STAFF.unsavedTitle}
          body={STAFF.unsavedBody}
          onClose={() => setUnsavedDialog(false)}
          testId="unsaved-dialog"
        >
          <Button variant="secondary" onClick={() => setUnsavedDialog(false)} data-testid="unsaved-back">
            {STAFF.unsavedBack}
          </Button>
          <Button
            onClick={() => {
              setUnsavedDialog(false);
              onExit();
            }}
            data-testid="unsaved-discard"
          >
            {STAFF.unsavedDiscard}
          </Button>
        </Dialog>
      ) : null}

      {categoryDialog !== null ? (
        <Dialog
          title={STAFF.confirmAction}
          body={STAFF.depResetWarning}
          onClose={() => setCategoryDialog(null)}
          testId="category-dialog"
        >
          <Button variant="secondary" onClick={() => setCategoryDialog(null)} data-testid="category-cancel">
            {STAFF.cancel}
          </Button>
          <Button onClick={() => applyCategoryChange(categoryDialog)} data-testid="category-confirm">
            {STAFF.confirm}
          </Button>
        </Dialog>
      ) : null}
    </div>
  );
}

// --- workbench --------------------------------------------------------------

export function ModerationWorkbench({
  listingId,
  status,
  revision,
  claimMine,
  claimOther,
  claimExpiresAt,
  editRevisionNo,
  currentUserId,
  subject,
  baseContent,
  baseImages,
  imageMin,
  adjustment,
  children,
}: {
  listingId: string;
  status: string;
  revision: number;
  claimMine: boolean;
  claimOther: boolean;
  claimExpiresAt: string | null;
  editRevisionNo: number | null;
  currentUserId: string;
  subject: AdjustmentSubject | null;
  baseContent: Record<string, unknown> | null;
  baseImages: AdjustmentBaseImage[];
  imageMin: number;
  adjustment: AdjustmentDto | null;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const [editing, setEditing] = useState(false);
  const [discardDialog, setDiscardDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canEdit = subject !== null && baseContent !== null && claimMine;
  const takeover = adjustment !== null && adjustment.savedBy.id !== currentUserId;

  async function discard() {
    if (busy || adjustment === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await publicFetch(`/api/v1/moderator/listings/${listingId}/adjustment/discard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_adjustment_revision: adjustment.revision }),
      });
      window.location.reload();
    } catch (cause) {
      setMessage(
        cause instanceof PublicApiError && cause.code === "MODERATION_CLAIM_REQUIRED"
          ? STAFF.claimRequired
          : STAFF.actionFailed,
      );
      setBusy(false);
      setDiscardDialog(false);
    }
  }

  // O.13 Stage D: BOTH subject types support adjusted decisions — the
  // only remaining lock is the editor's unsaved state (§28 protection).
  const lockedReason = editing ? STAFF.decisionsBlockedUnsaved : null;
  // concise changed-area labels for the sealed adjusted-approval
  // confirmation (server-resolved changes drive it)
  const adjustmentSummary = adjustment !== null
    ? [
        ...adjustment.changes.map((change) => FIELD_LABELS[change.field] ?? change.field),
        ...(adjustment.descriptionChange !== null ? [FIELD_LABELS.description] : []),
        ...(adjustment.equipmentAdded.length > 0 || adjustment.equipmentRemoved.length > 0
          ? [STAFF.secEquipment]
          : []),
        ...(adjustment.photoSummary.removedCount > 0 ||
        adjustment.photoSummary.primaryChanged ||
        adjustment.photoSummary.reordered
          ? [STAFF.images]
          : []),
      ]
    : [];

  return (
    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        {editing && subject !== null && baseContent !== null ? (
          <AdjustmentEditor
            listingId={listingId}
            subject={subject}
            baseContent={baseContent}
            baseImages={baseImages}
            adjustment={adjustment}
            imageMin={imageMin}
            onExit={() => setEditing(false)}
          />
        ) : (
          <>
            {adjustment !== null && takeover && claimMine ? (
              <section
                aria-label={STAFF.takeoverBanner}
                className="rounded-staff border-l-4 border-info bg-info-soft p-4"
                data-testid="takeover-card"
              >
                <p className="text-sm font-semibold text-info">{STAFF.takeoverBanner}</p>
                <p className="mt-1 text-xs text-slate-strong">{STAFF.takeoverNote}</p>
                <p className="mt-2 text-xs text-slate-strong" data-testid="takeover-attribution">
                  {STAFF.adjSavedBy}: {adjustment.savedBy.displayName ?? "—"} ·{" "}
                  {formatDateTime(adjustment.savedAt)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={() => setEditing(true)} disabled={busy || !hydrated} data-testid="takeover-continue">
                    {STAFF.takeoverContinue}
                  </Button>
                  <Button variant="secondary" onClick={() => setDiscardDialog(true)} disabled={busy || !hydrated} data-testid="takeover-discard">
                    {STAFF.takeoverDiscard}
                  </Button>
                </div>
              </section>
            ) : null}

            {adjustment !== null ? <AdjustmentSummary adjustment={adjustment} /> : null}

            {adjustment !== null && claimMine && !takeover ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setEditing(true)} disabled={busy || !hydrated} data-testid="adjustment-edit">
                  {STAFF.editEnter}
                </Button>
                <Button variant="secondary" onClick={() => setDiscardDialog(true)} disabled={busy || !hydrated} data-testid="adjustment-discard">
                  {STAFF.takeoverDiscard}
                </Button>
              </div>
            ) : null}

            {adjustment === null && canEdit ? (
              <div>
                <Button onClick={() => setEditing(true)} disabled={!hydrated} data-testid="adjustment-edit">
                  {STAFF.editEnter}
                </Button>
              </div>
            ) : null}

            {message !== null ? (
              <p role="alert" className="text-sm text-danger" data-testid="adjustment-message">
                {message}
              </p>
            ) : null}

            {children}
          </>
        )}
      </div>

      <div className="lg:sticky lg:top-16 lg:self-start">
        <ModerationActions
          listingId={listingId}
          status={status}
          revision={revision}
          claimMine={claimMine}
          claimOther={claimOther}
          claimExpiresAt={claimExpiresAt}
          editRevisionNo={editRevisionNo}
          lockedReason={lockedReason}
          adjustmentRevision={adjustment?.revision ?? null}
          adjustmentSummary={adjustmentSummary}
        />
      </div>

      {discardDialog && adjustment !== null ? (
        <Dialog
          title={STAFF.takeoverDiscard}
          body={STAFF.takeoverDiscardConfirm(adjustment.savedBy.displayName ?? "Moderator")}
          onClose={() => {
            // Escape = safe cancellation only — never while the discard
            // request is already in flight
            if (!busy) setDiscardDialog(false);
          }}
          testId="discard-dialog"
        >
          <Button variant="secondary" onClick={() => setDiscardDialog(false)} disabled={busy} data-testid="discard-cancel">
            {STAFF.cancel}
          </Button>
          <Button onClick={() => void discard()} disabled={busy} data-testid="discard-confirm">
            {STAFF.takeoverDiscard}
          </Button>
        </Dialog>
      ) : null}
    </div>
  );
}
