"use client";

import { useId, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { CatalogItem } from "@/components/seller/use-wizard-catalog";
import { equipmentMatches, groupEquipment } from "@/lib/marketplace/equipment";
import { SELLER, STAFF } from "@/lib/marketplace/labels";

/**
 * The shared O.11 grouped equipment picker core (search field + the
 * approved accordion groups + native checkboxes), extracted from the
 * seller EquipmentSelector so the O.13 moderator edit mode reuses the
 * SAME selector instead of forking it. Presentational: selection state
 * and persistence live with the caller. Seller test ids and behavior
 * are unchanged (default idPrefix "wizard-feature"); the moderator
 * passes its own prefix plus inline change markers ("əlavə edildi" /
 * "çıxarıldı") which are text, never color-only.
 */
export function EquipmentPicker({
  features,
  selectedIds,
  onToggle,
  markers,
  idPrefix = "wizard-feature",
}: {
  features: CatalogItem[];
  selectedIds: readonly string[];
  onToggle: (id: string, checked: boolean) => void;
  /** O.13 moderator markers by feature id (visible before save). */
  markers?: ReadonlyMap<string, "added" | "removed">;
  idPrefix?: string;
}) {
  const baseId = useId();
  const [query, setQuery] = useState("");
  // UI-only disclosure state (never persisted): first approved group
  // open by default. Search bypasses (but never rewrites) this set.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set(["SAFETY"]));

  const groups = useMemo(() => groupEquipment(features), [features]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const searching = query.trim() !== "";
  // The one-short-group catalog (MOTO: ABS only) hides search — one
  // visible row needs no filter (moto-abs-only reference).
  const searchable = groups.length > 1 || features.length > 5;

  const visibleGroups = useMemo(() => {
    if (!searching) return groups.map((g) => ({ ...g, visibleItems: g.items }));
    return groups
      .map((g) => ({ ...g, visibleItems: g.items.filter((f) => equipmentMatches(f.name, query)) }))
      .filter((g) => g.visibleItems.length > 0);
  }, [groups, searching, query]);

  function toggleGroup(code: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  }

  return (
    <div className="space-y-2" data-testid="wizard-features">
      {searchable ? (
        <div className="relative">
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query !== "") {
                e.preventDefault();
                e.stopPropagation();
                setQuery("");
              }
            }}
            aria-label={SELLER.equipmentSearchLabel}
            placeholder={SELLER.equipmentSearchPlaceholder}
            data-testid="equipment-search"
            className="h-11 w-full rounded-control border border-line-strong bg-raised pl-9 pr-24 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 md:h-10"
          />
          {query !== "" ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              data-testid="equipment-search-clear"
              className="absolute right-1.5 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-slate-strong transition-colors duration-150 hover:bg-row-hover"
            >
              <X size={12} aria-hidden="true" />
              {SELLER.equipmentSearchClear}
            </button>
          ) : null}
        </div>
      ) : null}

      {visibleGroups.length === 0 ? (
        <div className="rounded-control border border-line px-4 py-6 text-center" data-testid="equipment-no-results">
          <p className="text-[13px] font-medium text-ink">{SELLER.equipmentNoMatches}</p>
          <p className="mt-1 text-xs text-muted">{SELLER.equipmentNoMatchesHint}</p>
          <button
            type="button"
            onClick={() => setQuery("")}
            data-testid="equipment-no-results-clear"
            className="mt-3 inline-flex min-h-9 items-center rounded-control border border-line-strong px-3.5 text-[12.5px] font-semibold text-ink transition-colors duration-150 hover:border-muted"
          >
            {SELLER.equipmentClearSearch}
          </button>
        </div>
      ) : (
        <div className="rounded-control border border-line" role="group" aria-label={SELLER.features}>
          {visibleGroups.map((group, gi) => {
            const groupSelected = group.items.reduce((n, f) => n + (selected.has(f.id) ? 1 : 0), 0);
            const expanded = searching || openGroups.has(group.code);
            const regionId = `${baseId}-eq-${group.code}`;
            // O.11.5D a11y: in search mode collapse is bypassed,
            // so the header must NOT be a button whose activation
            // is a silent no-op — it renders as a plain row (same
            // visuals, no disclosure semantics). In normal mode it
            // is a real disclosure button; aria-controls is set
            // only while the region exists (no dangling id).
            const headerContent = (
              <>
                <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{group.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {groupSelected > 0 ? (
                    <span
                      className="rounded-pill bg-[#E7F2EC] px-2 py-0.5 text-[11px] font-semibold text-[#0F6440]"
                      data-testid={`equipment-group-count-${group.code}`}
                    >
                      {groupSelected} {SELLER.equipmentGroupSelectedWord}
                    </span>
                  ) : null}
                  <span aria-hidden="true" className={`text-muted transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}>
                    ▾
                  </span>
                </span>
              </>
            );
            const headerClass = `flex min-h-11 w-full items-center justify-between gap-2 px-3.5 py-2 text-left transition-colors duration-150 md:min-h-10 ${
              expanded ? "bg-[#F9F8F5]" : "hover:bg-row-hover"
            }`;
            return (
              <div key={group.code} className={gi > 0 ? "border-t border-line" : ""}>
                {searching ? (
                  <div data-testid={`equipment-group-${group.code}`} className={headerClass}>
                    {headerContent}
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={expanded ? regionId : undefined}
                    onClick={() => toggleGroup(group.code)}
                    data-testid={`equipment-group-${group.code}`}
                    className={headerClass}
                  >
                    {headerContent}
                  </button>
                )}
                {expanded ? (
                  <div id={regionId} className="grid grid-cols-1 gap-1 px-2 pb-2 desk:grid-cols-2" data-testid={`equipment-options-${group.code}`}>
                    {(searching ? group.visibleItems : group.items).map((feature) => {
                      const checked = selected.has(feature.id);
                      const marker = markers?.get(feature.id);
                      return (
                        <label
                          key={feature.id}
                          htmlFor={`${idPrefix}-${feature.id}`}
                          className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-[12.5px] transition-colors duration-150 hover:bg-row-hover md:min-h-9"
                        >
                          <input
                            id={`${idPrefix}-${feature.id}`}
                            data-testid={`${idPrefix}-${feature.id}`}
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-primary"
                            checked={checked}
                            onChange={(e) => onToggle(feature.id, e.target.checked)}
                          />
                          <span className={checked ? "font-semibold text-[#0F6440]" : "text-ink"}>{feature.name}</span>
                          {marker !== undefined ? (
                            <span
                              data-testid={`${idPrefix}-marker-${feature.id}`}
                              className={`rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold ${
                                marker === "added" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                              }`}
                            >
                              {marker === "added" ? STAFF.equipMarkerAdded : STAFF.equipMarkerRemoved}
                            </span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
