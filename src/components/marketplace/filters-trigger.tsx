"use client";

import { UI } from "@/lib/marketplace/labels";
import { buttonClasses } from "@/components/ui/button";

/**
 * Toolbar trigger for the filters drawer (mobile/tablet). The drawer
 * <dialog> lives in SearchFilters and is addressed by id so the
 * trigger can sit in the sticky results toolbar.
 */
export function FiltersTrigger({ activeCount }: { activeCount: number }) {
  return (
    <button
      type="button"
      className={buttonClasses("secondary", "desk:hidden gap-2")}
      aria-haspopup="dialog"
      onClick={() => {
        const dialog = document.getElementById("search-filters-drawer");
        if (dialog instanceof HTMLDialogElement) dialog.showModal();
      }}
      data-testid="filters-open"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h16M7 12h10M10 18h4" />
      </svg>
      {UI.filters}
      {activeCount > 0 ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-white">
          {activeCount}
        </span>
      ) : null}
    </button>
  );
}
