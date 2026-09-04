"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { UI } from "@/lib/marketplace/labels";
import type { ReferenceOptionDto } from "@/services/catalog";

/**
 * Shared multi-select (Phase 4.17O.2): a disclosure trigger with a
 * selected-values summary over a checkbox panel. Real checkboxes
 * carry the form `name`, so plain FormData.getAll() reads the
 * selection. The panel stays mounted (hidden ⇒ display:none, out of
 * the a11y tree), so closing never loses state.
 *
 * Interaction contract (accepted; identical in both variants):
 * trigger toggles; outside click closes (bubbling click, so the
 * outside element's own action completes before layout changes);
 * Escape closes and returns focus to the trigger (swallowed so an
 * outer <dialog> never closes with it); opening one instance closes
 * any other (module-local closer slot — no store); option clicks
 * keep the panel open.
 *
 * Variants:
 * - "inline" (default): the existing Search Results presentation —
 *   inline push-down panel. Unchanged.
 * - "1c": the approved Home Direction 1C system — h40/h44 trigger,
 *   ✕ group-clear before the chevron, color swatch prefixes,
 *   ANCHORED OVERLAY panel (offset 6, shadow, never pushes content),
 *   option rows h36/h44, Təmizlə (n) footer. Gated to Home usage.
 */

/** Smallest one-open-at-a-time mechanism: the currently open panel's closer. */
let closeOpenMultiSelect: (() => void) | null = null;

/** Multicolor placeholder swatch for the empty Rəng trigger (1c). */
function ConicSwatch() {
  return (
    <span
      aria-hidden="true"
      className="h-3 w-3 shrink-0 rounded-pill border border-black/15"
      style={{ background: "conic-gradient(#C62828, #F2C230, #2E7D32, #1E4FBF, #7B3FA0, #C62828)" }}
    />
  );
}

export function MultiSelectField({
  label,
  name,
  options,
  initialSelected,
  swatches = false,
  variant = "inline",
  panelWide = false,
  triggerClassName = "",
  testid,
}: {
  label: string;
  name: string;
  options: ReferenceOptionDto[];
  initialSelected: string[];
  swatches?: boolean;
  variant?: "inline" | "1c";
  /** Approved Rəng geometry: panel extends ~140px beyond the trigger
      at desk+ and shows every option without a scroll cut (design
      source: .pnl right:-140px). Other groups stay trigger-width. */
  panelWide?: boolean;
  /** Surface-specific geometry appended to the trigger. */
  triggerClassName?: string;
  testid: string;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(
    initialSelected.filter((id) => options.some((o) => o.id === id)),
  );
  const closerRef = useRef<(() => void) | null>(null);

  function openPanel() {
    closeOpenMultiSelect?.(); // close any other open instance first
    const closer = () => setOpen(false);
    closerRef.current = closer;
    closeOpenMultiSelect = closer;
    setOpen(true);
  }

  function closePanel() {
    // release the shared slot only if it is still ours
    if (closeOpenMultiSelect === closerRef.current) closeOpenMultiSelect = null;
    setOpen(false);
  }

  // Outside-click + Escape dismissal, active only while open;
  // listeners are removed on close/unmount (no leaks).
  useEffect(() => {
    if (!open) return;
    const onOutsideClick = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        closePanel();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // inline disclosure: swallow so neither an outer <dialog> nor
        // the advanced section reacts to the same keypress
        event.stopPropagation();
        event.preventDefault();
        closePanel();
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

  function toggle(id: string, checked: boolean) {
    setSelected((current) => (checked ? [...new Set([...current, id])] : current.filter((v) => v !== id)));
  }

  const selectedOptions = selected
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is ReferenceOptionDto => o !== undefined);
  const names = selectedOptions.map((o) => o.name);
  const summary =
    names.length === 0 ? UI.any : names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;

  const is1c = variant === "1c";
  const triggerClasses = is1c
    ? `flex min-h-10 w-full items-center gap-2 rounded-control border bg-raised px-3 text-left text-[13px] font-normal transition-colors duration-150 focus:outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 max-sm:min-h-11 ${open ? "border-primary" : "border-line-strong hover:border-muted"} ${triggerClassName}`
    : `flex min-h-10 w-full items-center justify-between gap-2 rounded-control border border-line-strong bg-raised px-3 text-left text-sm font-normal text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none max-md:min-h-12 ${triggerClassName}`;
  const panelClasses = is1c
    ? `absolute left-0 right-0 top-full z-30 mt-1.5 max-h-80 min-w-full overflow-y-auto rounded-lg border border-line bg-raised p-1.5 shadow-overlay max-sm:max-h-[60vh] ${panelWide ? "desk:-right-[140px] desk:max-h-none desk:overflow-visible" : ""}`
    : "mt-1 max-h-64 overflow-y-auto rounded-control border border-line-strong bg-raised p-1.5";
  const optionRow = is1c
    ? "flex min-h-9 cursor-pointer items-center gap-[9px] rounded-[5px] px-[9px] text-[12.5px] font-normal text-ink transition-colors duration-150 hover:bg-surface max-sm:min-h-11"
    : "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-sm font-normal text-ink transition-colors duration-150 hover:bg-primary-tint max-md:min-h-12";

  return (
    <div ref={rootRef} className={`block text-xs font-medium text-slate-strong ${is1c ? "relative" : ""}`}>
      <span className="mb-1.5 block text-[12px]">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? closePanel() : openPanel())}
        className={triggerClasses}
        data-testid={`${testid}-toggle`}
      >
        {is1c && swatches ? (
          selectedOptions.length === 0 ? (
            <ConicSwatch />
          ) : (
            <span aria-hidden="true" className="flex shrink-0 -space-x-1">
              {selectedOptions.slice(0, 2).map((o) => (
                <span
                  key={o.id}
                  className="h-3 w-3 rounded-pill border border-black/15 ring-1 ring-raised"
                  style={{ backgroundColor: o.swatch ?? "#8A8F98" }}
                />
              ))}
            </span>
          )
        ) : null}
        <span className={`min-w-0 flex-1 truncate whitespace-nowrap ${names.length === 0 ? "text-muted" : `text-ink ${is1c ? "font-medium" : ""}`}`}>
          {summary}
        </span>
        {is1c && selected.length > 0 ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label={`${label} — seçimi təmizlə`}
            onClick={(e) => {
              e.stopPropagation();
              setSelected([]);
            }}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors duration-150 hover:text-danger"
            data-testid={`${testid}-clear-x`}
          >
            <X size={12} strokeWidth={2.5} aria-hidden="true" />
          </span>
        ) : null}
        {open ? (
          <ChevronUp size={14} aria-hidden="true" className={`shrink-0 ${is1c ? "text-primary" : ""}`} />
        ) : (
          <ChevronDown size={14} aria-hidden="true" className={is1c ? "shrink-0 text-muted" : "shrink-0"} />
        )}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className={panelClasses}
        data-testid={`${testid}-panel`}
      >
        <div className={is1c && swatches ? "grid grid-cols-1 md:grid-cols-2" : ""}>
          {options.map((option) => (
            <label key={option.id} className={optionRow}>
              <input
                type="checkbox"
                name={name}
                value={option.id}
                checked={selected.includes(option.id)}
                onChange={(e) => toggle(option.id, e.target.checked)}
                className={`shrink-0 accent-primary ${is1c ? "size-4 rounded" : "size-5"}`}
                data-testid={`${testid}-opt-${option.code}`}
              />
              {swatches && option.swatch ? (
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-pill border border-black/15"
                  style={{ backgroundColor: option.swatch }}
                />
              ) : null}
              <span>{option.name}</span>
            </label>
          ))}
        </div>
        {is1c ? (
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-sunken px-[9px] pt-1.5">
            {selected.length > 0 ? (
              <button
                type="button"
                onClick={() => setSelected([])}
                className="inline-flex min-h-8 items-center text-xs font-semibold text-primary transition-colors duration-150 hover:text-primary-hover"
                data-testid={`${testid}-clear`}
              >
                Təmizlə ({selected.length})
              </button>
            ) : (
              <span />
            )}
            <span className="text-[11px] text-muted">Esc bağlayır</span>
          </div>
        ) : selected.length > 0 ? (
          <button
            type="button"
            onClick={() => setSelected([])}
            className="mt-1 inline-flex min-h-10 items-center rounded-control px-2 text-xs font-semibold text-slate-strong transition-colors duration-150 hover:text-danger"
            data-testid={`${testid}-clear`}
          >
            Seçimi təmizlə
          </button>
        ) : null}
      </div>
    </div>
  );
}
