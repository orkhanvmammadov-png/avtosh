"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

/**
 * O.7 in-place expanders (interactions.md): no navigation, no content
 * mutation — purely client-side presentation over the server-rendered
 * data. Both toggles carry aria-expanded.
 */

/** Features: initial cap of 8 rows, then "Bütün təchizatı göstər (n)". */
export function FeaturesList({ features }: { features: { code: string; name: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const cap = 8;
  const visible = expanded ? features : features.slice(0, cap);
  const hidden = features.length - cap;
  return (
    <div>
      <ul className="grid grid-cols-1 gap-[7px] sm:grid-cols-2" data-testid="features">
        {visible.map((f) => (
          <li key={f.code} className="flex items-center gap-2 text-[12.5px] text-ink">
            <Check size={13} strokeWidth={2.5} className="shrink-0 text-primary" aria-hidden="true" />
            {f.name}
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex min-h-8 items-center text-[12px] font-medium text-primary transition-colors duration-150 hover:text-primary-hover"
          data-testid="features-toggle"
        >
          {expanded ? "Gizlət ▴" : `Bütün təchizatı göstər (${features.length}) ▾`}
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
