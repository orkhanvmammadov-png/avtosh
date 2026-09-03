"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { UI } from "@/lib/marketplace/labels";
import type { ReferenceOptionDto } from "@/services/catalog";

/**
 * Shared compact multi-select (Phase 4.17O.2): a disclosure trigger
 * with a selected-values summary over an inline checkbox panel. Real
 * checkboxes carry the form `name`, so plain FormData.getAll() reads
 * the selection — no custom listbox semantics, no nested dialogs
 * (works inside the desktop rail, the mobile filter sheet and the
 * Home advanced panel alike). The panel stays mounted (hidden), so
 * closing never loses state. Color options render a circular
 * presentation swatch BEFORE the text label — never swatch-only.
 *
 * Closing behavior (UAT correction 1): trigger toggles; clicking
 * OUTSIDE the component closes; Escape closes and returns focus to
 * the trigger; opening one instance closes any other open instance
 * (module-local coordination — no store). This is an inline
 * disclosure, never a focus trap, so an outer <dialog> (the mobile
 * filter sheet) is unaffected.
 */

/** Smallest one-open-at-a-time mechanism: the currently open panel's closer. */
let closeOpenMultiSelect: (() => void) | null = null;

export function MultiSelectField({
  label,
  name,
  options,
  initialSelected,
  swatches = false,
  triggerClassName = "",
  testid,
}: {
  label: string;
  name: string;
  options: ReferenceOptionDto[];
  initialSelected: string[];
  swatches?: boolean;
  /** Surface-specific geometry (e.g. "min-h-12" on Home) appended to the trigger. */
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
  // listeners are removed on close/unmount (no leaks). Interactions
  // INSIDE the component root (trigger, checkboxes, swatches, clear)
  // never dismiss. The listener rides the bubbling CLICK (not
  // pointerdown) so the outside element's own action completes BEFORE
  // the inline panel collapses the layout under the pointer.
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
        // an inline disclosure: swallow the key so an outer <dialog>
        // (mobile filter sheet) does not also close
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

  const names = selected
    .map((id) => options.find((o) => o.id === id)?.name)
    .filter((n): n is string => n !== undefined);
  const summary =
    names.length === 0 ? UI.any : names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;

  return (
    <div ref={rootRef} className="block text-xs font-medium text-slate-strong">
      <span className="mb-1 block">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? closePanel() : openPanel())}
        className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-control border border-line-strong bg-raised px-3 text-left text-sm font-normal text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none max-md:min-h-12 ${triggerClassName}`}
        data-testid={`${testid}-toggle`}
      >
        <span className={`truncate whitespace-nowrap ${names.length === 0 ? "text-muted" : ""}`}>{summary}</span>
        {open ? <ChevronUp size={15} aria-hidden="true" className="shrink-0" /> : <ChevronDown size={15} aria-hidden="true" className="shrink-0" />}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="mt-1 max-h-64 overflow-y-auto rounded-control border border-line-strong bg-raised p-1.5"
        data-testid={`${testid}-panel`}
      >
        {options.map((option) => (
          <label
            key={option.id}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[5px] px-2 text-sm font-normal text-ink transition-colors duration-150 hover:bg-primary-tint max-md:min-h-12"
          >
            <input
              type="checkbox"
              name={name}
              value={option.id}
              checked={selected.includes(option.id)}
              onChange={(e) => toggle(option.id, e.target.checked)}
              className="size-5 shrink-0 accent-primary"
              data-testid={`${testid}-opt-${option.code}`}
            />
            {swatches && option.swatch ? (
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 rounded-pill border border-line-strong"
                style={{ backgroundColor: option.swatch }}
              />
            ) : null}
            <span>{option.name}</span>
          </label>
        ))}
        {selected.length > 0 ? (
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
