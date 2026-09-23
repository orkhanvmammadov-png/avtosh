"use client";

import { STAFF } from "@/lib/marketplace/labels";

/**
 * O.13 Stage B — ModeratorPhotoPlan (06-photos): a PRIVATE working
 * plan over the frozen submitted gallery. Remove (reversible until
 * save via Geri qaytar), reorder (accessible up/down controls at every
 * width), set primary (green outline + Əsas badge). NO upload control
 * exists by design — replacement photos require Düzəliş tələb et.
 * Removal is a working-state proposal only: no storage object is ever
 * touched from here.
 */

export interface PhotoPlanItem {
  sourceId: string;
  url: string | null;
  removed: boolean;
  isPrimary: boolean;
}

export function ModeratorPhotoPlan({
  items,
  minImages,
  onChange,
}: {
  items: PhotoPlanItem[];
  minImages: number;
  onChange: (next: PhotoPlanItem[]) => void;
}) {
  const keptCount = items.filter((item) => !item.removed).length;
  const belowMin = keptCount < minImages;

  function update(mutate: (next: PhotoPlanItem[]) => void) {
    const next = items.map((item) => ({ ...item }));
    mutate(next);
    // exactly one primary among kept images whenever any are kept
    const kept = next.filter((item) => !item.removed);
    if (kept.length > 0 && !kept.some((item) => item.isPrimary)) {
      kept[0].isPrimary = true;
    }
    for (const item of next) {
      if (item.removed) item.isPrimary = false;
    }
    onChange(next);
  }

  function toggleRemoved(index: number) {
    update((next) => {
      next[index].removed = !next[index].removed;
    });
  }

  function setPrimary(index: number) {
    update((next) => {
      for (const item of next) item.isPrimary = false;
      next[index].isPrimary = true;
      next[index].removed = false;
    });
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    update((next) => {
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
    });
  }

  return (
    <div data-testid="photo-plan">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {items.map((item, index) => (
          <li
            key={item.sourceId}
            className={`overflow-hidden rounded-staff border ${
              item.isPrimary ? "border-2 border-success" : "border-line"
            } bg-raised`}
            data-testid="photo-plan-item"
            data-source-id={item.sourceId}
            data-removed={item.removed}
            data-primary={item.isPrimary}
          >
            <div className={`relative ${item.removed ? "opacity-45" : ""}`}>
              {item.url !== null ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={item.url} alt={`${STAFF.images} ${index + 1}`} className="aspect-vehicle w-full object-cover text-transparent" />
              ) : (
                <div className="flex aspect-vehicle w-full items-center justify-center text-xs text-slate-strong">
                  {STAFF.noImage}
                </div>
              )}
              {item.isPrimary ? (
                <span className="absolute left-1.5 top-1.5 rounded-[3px] bg-success px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-white">
                  {STAFF.primaryTag}
                </span>
              ) : null}
              {item.removed ? (
                <span className="absolute left-1.5 top-1.5 rounded-[3px] bg-danger px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-white">
                  {STAFF.diffRemoved}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1 p-1.5">
              {item.removed ? (
                <button
                  type="button"
                  onClick={() => toggleRemoved(index)}
                  data-testid="photo-restore"
                  className="min-h-9 rounded-[6px] px-2 text-[12px] font-semibold text-primary transition-colors duration-150 hover:bg-row-hover"
                >
                  {STAFF.photoRestore}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => toggleRemoved(index)}
                    data-testid="photo-remove"
                    className="min-h-9 rounded-[6px] px-2 text-[12px] font-medium text-danger transition-colors duration-150 hover:bg-danger-soft"
                  >
                    {STAFF.photoRemove}
                  </button>
                  {!item.isPrimary ? (
                    <button
                      type="button"
                      onClick={() => setPrimary(index)}
                      data-testid="photo-set-primary"
                      className="min-h-9 rounded-[6px] px-2 text-[12px] font-medium text-slate-strong transition-colors duration-150 hover:bg-row-hover"
                    >
                      {STAFF.photoSetPrimary}
                    </button>
                  ) : null}
                </>
              )}
              <span className="ml-auto flex items-center">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`${STAFF.photoMoveUp} — ${index + 1}`}
                  data-testid="photo-move-up"
                  className="min-h-9 min-w-9 rounded-[6px] text-sm text-slate-strong transition-colors duration-150 hover:bg-row-hover disabled:opacity-35"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label={`${STAFF.photoMoveDown} — ${index + 1}`}
                  data-testid="photo-move-down"
                  className="min-h-9 min-w-9 rounded-[6px] text-sm text-slate-strong transition-colors duration-150 hover:bg-row-hover disabled:opacity-35"
                >
                  ↓
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      {belowMin ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger" data-testid="photo-min-error">
          {STAFF.photoMinError}
        </p>
      ) : null}
    </div>
  );
}
