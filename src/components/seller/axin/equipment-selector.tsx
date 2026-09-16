"use client";

import { useId, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { CatalogItem } from "@/components/seller/use-wizard-catalog";
import type { ListingEditor } from "@/components/seller/use-listing-editor";
import { equipmentMatches, groupEquipment } from "@/lib/marketplace/equipment";
import { SELLER } from "@/lib/marketplace/labels";

/**
 * O.11 seller equipment selector (4a — O.11 EQUIPMENT CATALOG UX):
 * outer Təchizat disclosure with an honest selected summary; open =
 * search field + the seven approved accordion groups (Təhlükəsizlik
 * expanded by default, groups derive from the loaded catalog so empty
 * groups — and the six CAR groups on MOTO — never render). Search is
 * a client-side filter over the loaded catalog: matching groups become
 * visible, zero-match groups hide, the seller's own disclosure state
 * is never mutated and returns when the query clears. Selection stays
 * UUID-backed through the existing draft editor PATCH; search typing
 * and accordion toggling never write to the draft.
 */
export function EquipmentSelector({ editor, features }: { editor: ListingEditor; features: CatalogItem[] }) {
  const { dto } = editor;
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // UI-only disclosure state (never persisted): first approved group
  // open by default. Search bypasses (but never rewrites) this set.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set(["SAFETY"]));

  const groups = useMemo(() => groupEquipment(features), [features]);
  const selected = useMemo(() => new Set(dto.featureIds), [dto.featureIds]);
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

  function toggleFeature(id: string, checked: boolean) {
    const ids = checked ? [...dto.featureIds, id] : dto.featureIds.filter((v) => v !== id);
    editor.patch({ feature_ids: ids }, { immediate: true });
  }

  if (features.length === 0) return null;

  const total = dto.featureIds.length;

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
        <div className="mt-2 space-y-2" data-testid="wizard-features">
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
                return (
                  <div key={group.code} className={gi > 0 ? "border-t border-line" : ""}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={regionId}
                      onClick={() => {
                        if (!searching) toggleGroup(group.code);
                      }}
                      data-testid={`equipment-group-${group.code}`}
                      className={`flex min-h-11 w-full items-center justify-between gap-2 px-3.5 py-2 text-left transition-colors duration-150 md:min-h-10 ${
                        expanded ? "bg-[#F9F8F5]" : "hover:bg-row-hover"
                      }`}
                    >
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
                    </button>
                    {expanded ? (
                      <div id={regionId} className="grid grid-cols-1 gap-1 px-2 pb-2 desk:grid-cols-2" data-testid={`equipment-options-${group.code}`}>
                        {(searching ? group.visibleItems : group.items).map((feature) => {
                          const checked = selected.has(feature.id);
                          return (
                            <label
                              key={feature.id}
                              htmlFor={`wizard-feature-${feature.id}`}
                              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-[12.5px] transition-colors duration-150 hover:bg-row-hover md:min-h-9"
                            >
                              <input
                                id={`wizard-feature-${feature.id}`}
                                data-testid={`wizard-feature-${feature.id}`}
                                type="checkbox"
                                className="h-4 w-4 shrink-0 accent-primary"
                                checked={checked}
                                onChange={(e) => toggleFeature(feature.id, e.target.checked)}
                              />
                              <span className={checked ? "font-semibold text-[#0F6440]" : "text-ink"}>{feature.name}</span>
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
      ) : null}
    </fieldset>
  );
}
