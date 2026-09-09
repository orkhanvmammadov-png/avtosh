"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { SEARCH_SORTS } from "@/lib/config/marketplace";
import { SORT_LABELS, UI } from "@/lib/marketplace/labels";
import { filtersFromSearchParams, normalizeSort, searchHref } from "@/lib/marketplace/search-params";

/**
 * Sort control, O.6 presentation over the unchanged contract: same
 * options (SEARCH_SORTS), same `sort` URL param and default, same
 * router.push refresh (a sort change drops any loaded cursor pages —
 * fresh page 1). Independent of filter state; open/close follows the
 * shared dismissal contract (outside click, Esc with focus return).
 */
export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = normalizeSort(params.get("sort") ?? undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onOutsideClick = (event: MouseEvent) => {
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
    document.addEventListener("click", onOutsideClick);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("click", onOutsideClick);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  function selectSort(sort: string) {
    setOpen(false);
    if (sort === current) return;
    const state = filtersFromSearchParams(new URLSearchParams(params.toString()));
    state.sort = sort;
    router.push(searchHref(state).replace("/elanlar", pathname));
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex min-h-8 items-center gap-1.5 rounded-control border bg-raised px-3 text-[12.5px] font-medium text-ink transition-colors duration-150 focus:outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 desk:min-h-9 ${open ? "border-primary" : "border-line-strong hover:border-muted"}`}
        data-testid="sort-select"
      >
        <span className="text-muted">{UI.sort}:</span>
        <span>{SORT_LABELS[current]}</span>
        {open ? (
          <ChevronUp size={14} aria-hidden="true" className="text-primary" />
        ) : (
          <ChevronDown size={14} aria-hidden="true" className="text-muted" />
        )}
      </button>
      <div
        role="listbox"
        aria-label={UI.sort}
        hidden={!open}
        className="absolute right-0 top-full z-30 mt-1.5 min-w-44 rounded-lg border border-line bg-raised p-1.5 shadow-overlay"
        data-testid="sort-panel"
      >
        {SEARCH_SORTS.map((sort) => (
          <div
            key={sort}
            role="option"
            aria-selected={sort === current}
            onClick={() => selectSort(sort)}
            className={`flex min-h-[34px] cursor-pointer items-center justify-between gap-3 rounded-[5px] px-2.5 text-[12.5px] text-ink transition-colors duration-150 hover:bg-surface ${sort === current ? "bg-surface font-medium" : ""}`}
            data-testid={`sort-opt-${sort}`}
          >
            {SORT_LABELS[sort]}
            {sort === current ? <Check size={14} aria-hidden="true" className="shrink-0 text-primary" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
