"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { Field } from "@/components/seller/wizard-fields";

/**
 * Seller-local single-select listbox family (Phase 4.17O.3): Year,
 * Engine and the Color palette. Visually aligned with the approved
 * O.2 / Direction 1C control language (anchored overlay panel,
 * swatch + label rows, Escape/outside-click dismissal with focus
 * return) but SINGLE-SELECT by contract and fully independent of the
 * sealed marketplace MultiSelectField — no shared code, no shared
 * one-open-at-a-time slot.
 *
 * The control is fully controlled by the server DTO: `value` comes in
 * from the editor's DTO and every change is patched immediately, so
 * conflict-reset remounts trivially render the latest server state.
 */

/**
 * One-open-at-a-time among SELLER listboxes only: opening announces
 * itself on the document; any other open instance hears it and closes
 * (the opener's own listener attaches after this render, so it never
 * closes itself). No shared mutable state.
 */
const OPEN_EVENT = "seller-listbox-open";

export interface ListboxOption {
  /** Persisted value (uuid or number) — sent to editor.patch verbatim. */
  value: string | number;
  label: string;
  /** Stable code for testids where available (e.g. color codes). */
  code?: string;
  /** Presentation-only swatch hex (colors). */
  swatch?: string | null;
}

/** Multicolor neutral swatch for the empty color trigger. */
function ConicSwatch() {
  return (
    <span
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 rounded-pill border border-black/15"
      style={{ background: "conic-gradient(#C62828, #F2C230, #2E7D32, #1E4FBF, #7B3FA0, #C62828)" }}
    />
  );
}

export function SellerListboxField({
  id,
  label,
  value,
  placeholder,
  options,
  swatches = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string | number | null;
  placeholder: string;
  options: ListboxOption[];
  /** Palette mode: radio indicator + circular swatch per row. */
  swatches?: boolean;
  onChange: (value: string | number | null) => void;
}) {
  const panelId = `${id}-panel`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const selected = selectedIndex === -1 ? null : options[selectedIndex];

  function openPanel() {
    document.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
    setActiveIndex(selectedIndex === -1 ? 0 : selectedIndex);
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
  }

  function selectOption(option: ListboxOption) {
    onChange(option.value);
    closePanel();
    triggerRef.current?.focus();
  }

  // Focus the panel on open so arrow keys work immediately.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Keep the active option in view while navigating / on open.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-opt-i${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, id]);

  // Outside-click + Escape dismissal (O.2 recipe): bubbling click so
  // an outside element's own action completes first; capture-phase
  // Escape swallowed so nothing above reacts, focus returns to the
  // trigger. Listeners exist only while open.
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
        event.stopPropagation();
        event.preventDefault();
        closePanel();
        triggerRef.current?.focus();
      }
    };
    const onOtherOpen = (event: Event) => {
      if ((event as CustomEvent).detail !== id) setOpen(false);
    };
    document.addEventListener("click", onOutsideClick);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener(OPEN_EVENT, onOtherOpen);
    return () => {
      document.removeEventListener("click", onOutsideClick);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener(OPEN_EVENT, onOtherOpen);
    };
  }, [open, id]);

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openPanel();
    }
  }

  function onPanelKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option !== undefined) selectOption(option);
    } else if (event.key === "Tab") {
      closePanel();
    }
  }

  return (
    <Field label={label} htmlFor={id}>
      <div ref={rootRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          id={id}
          data-testid={id}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? closePanel() : openPanel())}
          onKeyDown={onTriggerKeyDown}
          className={`flex min-h-12 w-full items-center gap-2 rounded-control border bg-raised px-3 text-left text-base transition-colors duration-150 focus:shadow-[0_0_0_2px_rgba(20,122,78,0.25)] focus:outline-none ${open ? "border-primary" : "border-line-strong hover:border-muted"}`}
        >
          {swatches ? (
            selected === null ? (
              <ConicSwatch />
            ) : (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 rounded-pill border border-black/15"
                style={{ backgroundColor: selected.swatch ?? "#8A8F98" }}
              />
            )
          ) : null}
          <span className={`min-w-0 flex-1 truncate ${selected === null ? "text-muted" : "text-ink"}`}>
            {selected === null ? placeholder : selected.label}
          </span>
          {selected !== null ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label={`${label} — seçimi təmizlə`}
              data-testid={`${id}-clear`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                closePanel();
              }}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors duration-150 hover:text-danger"
            >
              <X size={14} strokeWidth={2.5} aria-hidden="true" />
            </span>
          ) : null}
          {open ? (
            <ChevronUp size={16} aria-hidden="true" className="shrink-0 text-primary" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-muted" />
          )}
        </button>
        <div
          ref={panelRef}
          id={panelId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          hidden={!open}
          aria-activedescendant={open ? `${id}-opt-i${activeIndex}` : undefined}
          onKeyDown={onPanelKeyDown}
          data-testid={panelId}
          className="absolute left-0 right-0 top-full z-[60] mt-1.5 max-h-64 overflow-y-auto rounded-lg border border-line bg-raised p-1.5 shadow-overlay focus:outline-none max-sm:max-h-[50vh]"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <div
                key={option.value}
                id={`${id}-opt-i${index}`}
                role="option"
                aria-selected={isSelected}
                data-testid={`${id}-opt-${option.code ?? option.value}`}
                onClick={() => selectOption(option)}
                onMouseMove={() => setActiveIndex(index)}
                className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 text-sm text-ink transition-colors duration-150 ${index === activeIndex ? "bg-surface" : ""}`}
              >
                {swatches ? (
                  <>
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border ${isSelected ? "border-primary" : "border-line-strong"}`}
                    >
                      {isSelected ? <span className="h-2 w-2 rounded-pill bg-primary" /> : null}
                    </span>
                    <span
                      aria-hidden="true"
                      data-swatch={option.swatch ?? ""}
                      className="h-3.5 w-3.5 shrink-0 rounded-pill border border-black/15"
                      style={{ backgroundColor: option.swatch ?? "#8A8F98" }}
                    />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected ? <Check size={16} aria-hidden="true" className="shrink-0 text-primary" /> : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Field>
  );
}
