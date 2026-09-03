"use client";

import { useId, useState } from "react";
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
 * collapsing never loses state. Color options render a circular
 * presentation swatch BEFORE the text label — never swatch-only.
 */
export function MultiSelectField({
  label,
  name,
  options,
  initialSelected,
  swatches = false,
  testid,
}: {
  label: string;
  name: string;
  options: ReferenceOptionDto[];
  initialSelected: string[];
  swatches?: boolean;
  testid: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(
    initialSelected.filter((id) => options.some((o) => o.id === id)),
  );

  function toggle(id: string, checked: boolean) {
    setSelected((current) => (checked ? [...new Set([...current, id])] : current.filter((v) => v !== id)));
  }

  const names = selected
    .map((id) => options.find((o) => o.id === id)?.name)
    .filter((n): n is string => n !== undefined);
  const summary =
    names.length === 0 ? UI.any : names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;

  return (
    <div className="block text-xs font-medium text-slate-strong">
      <span className="mb-1 block">{label}</span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-control border border-line-strong bg-raised px-3 text-left text-sm font-normal text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none max-md:min-h-12"
        data-testid={`${testid}-toggle`}
      >
        <span className={`truncate ${names.length === 0 ? "text-muted" : ""}`}>{summary}</span>
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
