"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { SELLER } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import type { TypeaheadItem } from "@/components/seller/axin/typeahead-field";

/**
 * ONE hierarchical single-choice "Model" field (owner decision): the
 * seller picks a model family and, when that family has active Alt
 * models, exactly ONE of them — no separate Alt model field. A family
 * with zero active variants is selected directly and stores NULL.
 *
 * Two-level listbox in the sealed TypeaheadField visual contract:
 * level 1 filters families as you type; picking a family loads its
 * variants from the sealed /api/v1/catalog/model-variants endpoint —
 * zero variants commits the family immediately, otherwise level 2
 * shows the children (with a back row). The trigger displays the
 * selected path, e.g. "3-series → 318". Emits both ids in ONE
 * onSelect so the server persists model_id + model_variant_id
 * together; dependent resets remain server-authoritative.
 */
export function ModelPathField({
  id,
  label,
  category,
  brandId,
  families,
  valueModelId,
  valueVariantId,
  variantNames,
  disabled = false,
  disabledHint,
  loading = false,
  onSelect,
}: {
  id: string;
  label: string;
  category: string;
  brandId: string | null;
  families: TypeaheadItem[];
  valueModelId: string | null;
  valueVariantId: string | null;
  /** Known variant names (wizard catalog) for path display. */
  variantNames: (id: string | null) => string | null;
  disabled?: boolean;
  disabledHint?: string;
  loading?: boolean;
  onSelect: (modelId: string | null, variantId: string | null, variantName: string | null) => void;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [level, setLevel] = useState<
    { kind: "families" } | { kind: "variants"; family: TypeaheadItem; items: TypeaheadItem[] }
  >({ kind: "families" });
  const [loadingFamilyId, setLoadingFamilyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filteredFamilies = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("az");
    if (q === "") return families;
    return families.filter((f) => f.name.toLocaleLowerCase("az").includes(q));
  }, [families, query]);
  const rows: TypeaheadItem[] = level.kind === "families" ? filteredFamilies : level.items;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    setLevel({ kind: "families" });
    setActiveIndex(0);
    setLoadError(null);
  }

  function commit(modelId: string, variantId: string | null, variantName: string | null) {
    onSelect(modelId, variantId, variantName);
    close();
    inputRef.current?.focus();
  }

  async function pickFamily(family: TypeaheadItem) {
    if (brandId === null || loadingFamilyId !== null) return;
    setLoadingFamilyId(family.id);
    setLoadError(null);
    try {
      const r = await publicFetch<TypeaheadItem[]>(
        `/api/v1/catalog/model-variants?category=${encodeURIComponent(category)}&brand_id=${encodeURIComponent(brandId)}&model_id=${encodeURIComponent(family.id)}`,
      );
      if (r.data.length === 0) {
        commit(family.id, null, null); // CONFIRMED zero-variant family
      } else {
        setLevel({ kind: "variants", family, items: r.data });
        setActiveIndex(0);
      }
    } catch {
      // A failed request is NOT a confirmed zero-variant family: keep
      // the previous selection, surface the error, allow retry.
      setLoadError(SELLER.modelVariantsLoadError);
    } finally {
      setLoadingFamilyId(null);
    }
  }

  function back() {
    setLevel({ kind: "families" });
    setActiveIndex(0);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        if (level.kind === "variants") {
          back();
        } else {
          close();
        }
      }
      return;
    }
    if (event.key === "Backspace" && level.kind === "variants" && query === "") {
      event.preventDefault();
      back();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (rows.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => Math.min(rows.length - 1, Math.max(0, i + delta)));
      const next = listRef.current?.children[
        Math.min(rows.length - 1, Math.max(0, activeIndex + delta)) + (level.kind === "variants" ? 1 : 0)
      ] as HTMLElement | undefined;
      next?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter") {
      if (open && rows[activeIndex] !== undefined) {
        event.preventDefault();
        if (level.kind === "families") {
          void pickFamily(rows[activeIndex]);
        } else {
          commit(level.family.id, rows[activeIndex].id, rows[activeIndex].name);
        }
      }
      return;
    }
    if (event.key === "Tab") {
      close();
    }
  }

  const familyName = families.find((f) => f.id === valueModelId)?.name ?? null;
  const variantName = variantNames(valueVariantId);
  const pathDisplay =
    valueModelId === null
      ? ""
      : variantName === null
        ? (familyName ?? "")
        : `${familyName ?? "…"} → ${variantName}`;
  const display = open ? query : pathDisplay;
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
          aria-activedescendant={
            open && rows[activeIndex] !== undefined ? `${listboxId}-${rows[activeIndex].id}` : undefined
          }
          autoComplete="off"
          disabled={disabled}
          placeholder={showHint ? disabledHint : SELLER.searchTypeahead}
          value={display}
          readOnly={level.kind === "variants"}
          data-testid={id}
          className="h-11 w-full rounded-control desk:h-10 border border-line-strong bg-raised pl-3 pr-8 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted"
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
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted">
          {loading || loadingFamilyId !== null ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" data-testid={`${id}-loading`} />
          ) : (
            <ChevronDown size={15} aria-hidden="true" />
          )}
        </span>
      </div>
      {loadError !== null ? (
        <p role="alert" className="mt-1 text-xs text-danger" data-testid={`${id}-load-error`}>
          {loadError}
        </p>
      ) : null}
      {open && !disabled ? (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          data-testid={`${id}-listbox`}
          className="absolute z-30 mt-1 max-h-[45vh] w-full overflow-y-auto rounded-control border border-line bg-raised py-1 shadow-lg desk:max-h-80"
        >
          {level.kind === "variants" ? (
            <li
              role="option"
              aria-selected={false}
              data-testid={`${id}-back`}
              className="flex h-11 cursor-pointer items-center gap-1.5 border-b border-sunken px-3 text-[13px] font-semibold text-slate-strong desk:h-9"
              onPointerDown={(e) => {
                e.preventDefault();
                back();
              }}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              <span className="truncate">{level.family.name}</span>
            </li>
          ) : null}
          {rows.length === 0 ? (
            <li className="flex h-11 items-center px-3 text-[13px] text-muted desk:h-9" data-testid={`${id}-empty`}>
              {SELLER.noResults}
            </li>
          ) : (
            rows.map((item, index) => {
              const isSelected =
                level.kind === "families" ? item.id === valueModelId : item.id === valueVariantId;
              return (
                <li
                  key={item.id}
                  id={`${listboxId}-${item.id}`}
                  role="option"
                  aria-selected={isSelected}
                  data-testid={`${id}-option`}
                  className={`flex h-11 cursor-pointer items-center justify-between gap-2 px-3 text-[13px] text-ink desk:h-9 ${
                    index === activeIndex ? "bg-row-hover" : ""
                  } ${level.kind === "variants" ? "pl-6" : ""}`}
                  onPointerEnter={() => setActiveIndex(index)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    if (level.kind === "families") {
                      void pickFamily(item);
                    } else {
                      commit(level.family.id, item.id, item.name);
                    }
                  }}
                >
                  <span className="truncate">{item.name}</span>
                  {isSelected ? (
                    <Check size={14} className="shrink-0 text-primary" aria-hidden="true" />
                  ) : level.kind === "families" && item.id === loadingFamilyId ? (
                    <Loader2 size={14} className="shrink-0 animate-spin text-muted" aria-hidden="true" />
                  ) : level.kind === "families" ? (
                    <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
