"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, X } from "lucide-react";
import { UI } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import type { ModelDto, ModelVariantDto } from "@/services/catalog";

/**
 * ONE hierarchical "Model" search control (owner decision): model
 * families with their Alt models nested beneath, multi-select.
 * - checking a family = ALL its listings (every variant + legacy
 *   NULL-variant rows); its children then render checked+disabled so
 *   redundant child selections cannot exist (normalization);
 * - checking children selects exactly those variants;
 * - selections across families combine with OR (the API's one OR
 *   group); everything else on the form stays AND.
 * Variants load lazily on first expand via the sealed
 * /api/v1/catalog/model-variants endpoint. Disclosure/keyboard/outside
 * -click behavior follows the approved MultiSelectField contract
 * (native buttons + checkboxes, Escape closes and refocuses).
 */

export interface ModelTreeSelection {
  familyIds: string[];
  /** Full rows so the trigger summary and chips can name paths. */
  variants: ModelVariantDto[];
}

export function ModelTreeSelect({
  label,
  category,
  brandId,
  families,
  selection,
  onChange,
  disabled = false,
  testid,
}: {
  label: string;
  category: string;
  brandId: string;
  families: ModelDto[];
  selection: ModelTreeSelection;
  onChange: (next: ModelTreeSelection) => void;
  disabled?: boolean;
  testid: string;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [variantsByFamily, setVariantsByFamily] = useState<
    Record<string, ModelVariantDto[] | "loading" | "error">
  >({});

  useEffect(() => {
    if (!open) return;
    // pointerdown, not click: an expand click swaps its chevron icon,
    // so by bubbling-click time the original target is detached and a
    // containment check would wrongly read as "outside".
    const onOutsidePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onOutsidePointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onOutsidePointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  function loadVariants(familyId: string, force = false) {
    const cached = variantsByFamily[familyId];
    if (!force && cached !== undefined && cached !== "error") return;
    setVariantsByFamily((current) => ({ ...current, [familyId]: "loading" }));
    void publicFetch<ModelVariantDto[]>(
      `/api/v1/catalog/model-variants?category=${encodeURIComponent(category)}&brand_id=${encodeURIComponent(brandId)}&model_id=${encodeURIComponent(familyId)}`,
    )
      .then((r) => setVariantsByFamily((current) => ({ ...current, [familyId]: r.data })))
      // A failed load must never look like a confirmed empty family.
      .catch(() => setVariantsByFamily((current) => ({ ...current, [familyId]: "error" })));
  }

  function toggleExpand(familyId: string) {
    if (!expanded.has(familyId)) {
      loadVariants(familyId); // effectful work stays outside the updater
    }
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(familyId)) {
        next.delete(familyId);
      } else {
        next.add(familyId);
      }
      return next;
    });
  }

  function toggleFamily(familyId: string, checked: boolean) {
    const familyIds = checked
      ? [...new Set([...selection.familyIds, familyId])]
      : selection.familyIds.filter((id) => id !== familyId);
    // Checking a family absorbs (removes) its now-redundant variants.
    const variants = checked
      ? selection.variants.filter((v) => v.modelId !== familyId)
      : selection.variants;
    onChange({ familyIds, variants });
  }

  function toggleVariant(variant: ModelVariantDto, checked: boolean) {
    const variants = checked
      ? [...selection.variants.filter((v) => v.id !== variant.id), variant]
      : selection.variants.filter((v) => v.id !== variant.id);
    onChange({ familyIds: selection.familyIds, variants });
  }

  const familyName = (id: string): string => families.find((f) => f.id === id)?.name ?? "…";
  const pathLabels = [
    ...selection.familyIds.map((id) => familyName(id)),
    ...selection.variants.map((v) => `${familyName(v.modelId)} › ${v.name}`),
  ];
  const summary =
    pathLabels.length === 0
      ? UI.any
      : pathLabels.length <= 2
        ? pathLabels.join(", ")
        : `${pathLabels.slice(0, 2).join(", ")} +${pathLabels.length - 2}`;
  const count = selection.familyIds.length + selection.variants.length;

  return (
    <div ref={rootRef} className="relative block text-xs font-medium text-slate-strong">
      <span className="mb-1.5 block text-[12px]">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-12 w-full items-center gap-2 rounded-control border bg-raised px-3 text-left text-sm font-normal transition-colors duration-150 focus:outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted ${open ? "border-primary" : "border-line-strong hover:border-muted"}`}
        data-testid={`${testid}-toggle`}
      >
        <span className={`min-w-0 flex-1 truncate whitespace-nowrap ${count === 0 ? "text-muted" : "font-medium text-ink"}`}>
          {summary}
        </span>
        {count > 0 ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={`${label} — seçimi təmizlə`}
            onClick={(e) => {
              e.stopPropagation();
              onChange({ familyIds: [], variants: [] });
            }}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors duration-150 hover:text-danger"
            data-testid={`${testid}-clear-x`}
          >
            <X size={12} strokeWidth={2.5} aria-hidden="true" />
          </span>
        ) : null}
        {open ? (
          <ChevronUp size={14} aria-hidden="true" className="shrink-0 text-primary" />
        ) : (
          <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-muted" />
        )}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-80 overflow-y-auto rounded-lg border border-line bg-raised p-1.5 shadow-overlay max-sm:max-h-[60vh]"
        data-testid={`${testid}-panel`}
      >
        {families.map((family) => {
          const familyChecked = selection.familyIds.includes(family.id);
          const isExpanded = expanded.has(family.id);
          const loaded = variantsByFamily[family.id];
          const children = Array.isArray(loaded) ? loaded : [];
          return (
            <div key={family.id}>
              <div className="flex min-h-11 items-center gap-1 rounded-[5px] px-1 transition-colors duration-150 hover:bg-surface">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={`${family.name} — alt modellər`}
                  onClick={() => toggleExpand(family.id)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors duration-150 hover:text-ink"
                  data-testid={`${testid}-expand-${family.slug}`}
                >
                  {isExpanded ? (
                    <ChevronDown size={14} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={14} aria-hidden="true" />
                  )}
                </button>
                <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2.5 text-sm font-normal text-ink">
                  <input
                    type="checkbox"
                    checked={familyChecked}
                    onChange={(e) => toggleFamily(family.id, e.target.checked)}
                    className="size-4 shrink-0 rounded accent-primary"
                    data-testid={`${testid}-family-${family.slug}`}
                  />
                  <span>{family.name}</span>
                </label>
              </div>
              {isExpanded ? (
                loaded === "loading" ? (
                  <p className="py-1.5 pl-12 text-[12px] text-muted">Yüklənir…</p>
                ) : loaded === "error" ? (
                  <p className="flex items-center gap-2 py-1.5 pl-12 text-[12px] text-danger" role="alert">
                    Alt modellər yüklənmədi.
                    <button
                      type="button"
                      onClick={() => loadVariants(family.id, true)}
                      className="font-semibold text-primary transition-colors duration-150 hover:text-primary-hover"
                      data-testid={`${testid}-retry-${family.slug}`}
                    >
                      Yenidən cəhd et
                    </button>
                  </p>
                ) : children.length === 0 ? (
                  <p className="py-1.5 pl-12 text-[12px] text-muted">Alt model yoxdur</p>
                ) : (
                  children.map((variant) => {
                    const variantChecked =
                      familyChecked || selection.variants.some((v) => v.id === variant.id);
                    return (
                      <label
                        key={variant.id}
                        className={`flex min-h-10 items-center gap-2.5 rounded-[5px] py-0.5 pl-12 pr-2 text-sm font-normal transition-colors duration-150 ${familyChecked ? "cursor-not-allowed text-muted" : "cursor-pointer text-ink hover:bg-surface"}`}
                      >
                        <input
                          type="checkbox"
                          checked={variantChecked}
                          disabled={familyChecked}
                          onChange={(e) => toggleVariant(variant, e.target.checked)}
                          className="size-4 shrink-0 rounded accent-primary"
                          data-testid={`${testid}-variant-${variant.slug}`}
                        />
                        <span>{variant.name}</span>
                      </label>
                    );
                  })
                )
              ) : null}
            </div>
          );
        })}
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-sunken px-[9px] pt-1.5">
          {count > 0 ? (
            <button
              type="button"
              onClick={() => onChange({ familyIds: [], variants: [] })}
              className="inline-flex min-h-8 items-center text-xs font-semibold text-primary transition-colors duration-150 hover:text-primary-hover"
              data-testid={`${testid}-clear`}
            >
              Təmizlə ({count})
            </button>
          ) : (
            <span />
          )}
          <span className="text-[11px] text-muted">Esc bağlayır</span>
        </div>
      </div>
    </div>
  );
}
