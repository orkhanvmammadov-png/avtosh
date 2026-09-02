"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SEARCH_SORTS } from "@/lib/config/marketplace";
import { SORT_LABELS, UI } from "@/lib/marketplace/labels";
import { filtersFromSearchParams, normalizeSort, searchHref } from "@/lib/marketplace/search-params";

/** Sort lives in the URL; changing it drops any loaded cursor pages (fresh page 1). */
export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = normalizeSort(params.get("sort") ?? undefined);
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <span className="font-medium">{UI.sort}</span>
      <select
        value={current}
        data-testid="sort-select"
        className="min-h-12 rounded-control border border-line bg-raised px-3 text-sm transition-colors hover:border-line-strong"
        onChange={(e) => {
          const state = filtersFromSearchParams(new URLSearchParams(params.toString()));
          state.sort = e.target.value;
          router.push(searchHref(state).replace("/elanlar", pathname));
        }}
      >
        {SEARCH_SORTS.map((sort) => <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>)}
      </select>
    </label>
  );
}
