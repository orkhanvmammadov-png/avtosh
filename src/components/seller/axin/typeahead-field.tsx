"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { SELLER } from "@/lib/marketplace/labels";

export interface TypeaheadItem {
  id: string;
  name: string;
}

/**
 * O.9 AXIN Brand/Model typeahead (components.md): search-as-you-type
 * over the loaded catalog, dropdown width = trigger, ~320px scroll,
 * option rows h-9, hover row tint, selected row green ✓. Keyboard:
 * type→filter, ↑/↓, Enter select, Esc close. Selection semantics stay
 * those of the sealed SelectField contract: emits the item id (UUID)
 * or null on clear; the SERVER DTO remains the single source of truth
 * for dependent resets.
 */
export function TypeaheadField({
  id,
  label,
  value,
  items,
  placeholder,
  disabled = false,
  disabledHint,
  loading = false,
  error = null,
  clearable = false,
  clearOnDirtyClose = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  items: TypeaheadItem[];
  placeholder?: string;
  disabled?: boolean;
  /** Shown inside the control while disabled (e.g. "Marka seçin"). */
  disabledHint?: string;
  loading?: boolean;
  error?: string | null;
  /** Search surfaces: render an accessible ✕ that emits null. */
  clearable?: boolean;
  /** Search surfaces: closing with a typed, unselected query must
      never silently keep the old selection — it emits null instead.
      Listing creation keeps the sealed revert-on-close behavior. */
  clearOnDirtyClose?: boolean;
  onChange: (id: string | null) => void;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(() => items.find((i) => i.id === value) ?? null, [items, value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("az");
    if (q === "") return items;
    return items.filter((i) => i.name.toLocaleLowerCase("az").includes(q));
  }, [items, query]);

  function closeWithoutSelection() {
    if (
      clearOnDirtyClose &&
      value !== null &&
      query.trim() !== "" &&
      query.trim() !== (selected?.name ?? "")
    ) {
      onChange(null);
    }
    setOpen(false);
    setQuery("");
  }

  // Outside click closes without selection.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        closeWithoutSelection();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  });

  function select(item: TypeaheadItem) {
    onChange(item.id);
    setOpen(false);
    setQuery("");
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        closeWithoutSelection();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      // An empty list (still loading, or no matches) must not corrupt
      // activeIndex to -1 — Enter would stay dead even after options
      // arrive. Arrow on an empty list is a no-op; index 0 stays valid
      // for the moment results render.
      if (filtered.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => Math.min(filtered.length - 1, Math.max(0, i + delta)));
      const next = listRef.current?.children[
        Math.min(filtered.length - 1, Math.max(0, activeIndex + delta))
      ] as HTMLElement | undefined;
      next?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      if (open && filtered[activeIndex] !== undefined) {
        event.preventDefault();
        select(filtered[activeIndex]);
      }
      return;
    }
    if (event.key === "Tab") {
      closeWithoutSelection();
    }
  }

  const display = open ? query : (selected?.name ?? "");
  const showHint = disabled && disabledHint !== undefined;

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-strong">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[activeIndex] !== undefined ? `${listboxId}-${filtered[activeIndex].id}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={showHint ? disabledHint : (placeholder ?? SELLER.searchTypeahead)}
          value={display}
          data-testid={id}
          className={`h-11 w-full rounded-control desk:h-10 border bg-raised pl-3 ${clearable && value !== null && !open ? "pr-14" : "pr-8"} text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted ${
            error !== null ? "border-danger" : "border-line-strong"
          }`}
          onFocus={() => {
            if (!disabled) {
              setOpen(true);
              setActiveIndex(0);
            }
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {clearable && value !== null && !open ? (
          <button
            type="button"
            aria-label={`${label} — seçimi təmizlə`}
            data-testid={`${id}-clear`}
            onClick={() => {
              setQuery("");
              onChange(null);
            }}
            className="absolute right-7 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-muted transition-colors duration-150 hover:text-danger"
          >
            <X size={13} strokeWidth={2.5} aria-hidden="true" />
          </button>
        ) : null}
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted">
          {loading ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" data-testid={`${id}-loading`} />
          ) : (
            <ChevronDown size={15} aria-hidden="true" />
          )}
        </span>
      </div>
      {open && !disabled ? (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          data-testid={`${id}-listbox`}
          className="absolute z-30 mt-1 max-h-[45vh] w-full overflow-y-auto rounded-control border border-line bg-raised py-1 shadow-lg desk:max-h-80"
        >
          {filtered.length === 0 ? (
            <li className="flex h-11 items-center px-3 text-[13px] text-muted desk:h-9" data-testid={`${id}-empty`}>
              {SELLER.noResults}
            </li>
          ) : (
            filtered.map((item, index) => {
              const isSelected = item.id === value;
              return (
                <li
                  key={item.id}
                  id={`${listboxId}-${item.id}`}
                  role="option"
                  aria-selected={isSelected}
                  data-testid={`${id}-option`}
                  className={`flex h-11 cursor-pointer items-center justify-between gap-2 px-3 text-[13px] text-ink desk:h-9 ${
                    index === activeIndex ? "bg-row-hover" : ""
                  }`}
                  onPointerEnter={() => setActiveIndex(index)}
                  onPointerDown={(e) => {
                    e.preventDefault(); // keep input focus
                    select(item);
                  }}
                >
                  <span className="truncate">{item.name}</span>
                  {isSelected ? <Check size={14} className="shrink-0 text-primary" aria-hidden="true" /> : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
      {error !== null ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
