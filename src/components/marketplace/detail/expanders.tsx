"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { groupEquipment } from "@/lib/marketplace/equipment";

/**
 * O.7 in-place expanders (interactions.md): no navigation, no content
 * mutation — purely client-side presentation over the server-rendered
 * data. Both toggles carry aria-expanded.
 */

/**
 * O.11 grouped equipment (detail.md — SEALED pattern): only
 * listing-selected features, bucketed by the approved taxonomy in
 * fixed group order with catalog sort_order inside each group (the
 * server already delivers that order); empty groups never render and
 * legacy null/unknown groups fall into a trailing "Digər". ≤12 items
 * render fully with no control; >12 collapse to the FIRST 12 of the
 * canonical flattened order (regrouped for display) behind ONE overall
 * "Bütün təchizatı göstər (n)" / "Gizlət" button — never per-group
 * buyer accordions. Pure presentation state: no URL, no persistence.
 */
export function FeaturesList({ features }: { features: { code: string; name: string; group: string | null }[] }) {
  const [expanded, setExpanded] = useState(false);
  const cap = 12;
  // canonical order: approved group order → item order within group
  const grouped = groupEquipment(features);
  const canonical = grouped.flatMap((g) => g.items.map((item) => ({ ...item, groupCode: g.code, groupLabel: g.label })));
  const visible = expanded ? canonical : canonical.slice(0, cap);
  const visibleGroups = groupEquipment(visible);
  const hidden = canonical.length - cap;
  return (
    <div>
      <div className="space-y-3" data-testid="features">
        {visibleGroups.map((group) => (
          <div key={group.code} data-testid={`features-group-${group.code}`}>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted">{group.label}</h3>
            <ul className="mt-1.5 grid grid-cols-1 gap-[7px] sm:grid-cols-2">
              {group.items.map((f) => (
                <li key={f.code} className="flex items-center gap-2 text-[12.5px] text-ink">
                  <Check size={13} strokeWidth={2.5} className="shrink-0 text-primary" aria-hidden="true" />
                  {f.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-2.5 inline-flex min-h-9 items-center text-[12px] font-medium text-primary transition-colors duration-150 hover:text-primary-hover"
          data-testid="features-toggle"
        >
          {expanded ? "Gizlət ▴" : `Bütün təchizatı göstər (${canonical.length}) ▾`}
        </button>
      ) : null}
    </div>
  );
}

/** Description: 6-line clamp only when the text genuinely overflows. */
export function DescriptionClamp({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el !== null) setClampable(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <div>
      <p
        ref={bodyRef}
        className={`whitespace-pre-line text-[13px] leading-relaxed text-[#45413c] ${expanded ? "" : "line-clamp-6"}`}
        data-testid="description"
      >
        {text}
      </p>
      {clampable || expanded ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex min-h-8 items-center text-[12px] font-semibold text-primary transition-colors duration-150 hover:text-primary-hover"
          data-testid="description-toggle"
        >
          {expanded ? "Daha az ▴" : "Daha çox ▾"}
        </button>
      ) : null}
    </div>
  );
}
