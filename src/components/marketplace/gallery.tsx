"use client";

import { useState } from "react";
import { ListingImage } from "@/components/shared/listing-image";
import { UI } from "@/lib/marketplace/labels";

export interface GalleryImage {
  url: string | null;
  width: number | null;
  height: number | null;
  isPrimary: boolean;
}

/**
 * Desktop: large image + thumbnail buttons. Mobile: scroll-snap strip
 * with a counter. Pure CSS/React, no carousel dependency. Signed URLs
 * are used as-is — never rebuilt client-side.
 */
export function Gallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const list = images.length > 0 ? images : [{ url: null, width: null, height: null, isPrimary: true }];
  const [active, setActive] = useState(Math.max(0, list.findIndex((i) => i.isPrimary)));
  const current = list[active] ?? list[0];
  return (
    <div data-testid="gallery">
      {/* Mobile strip */}
      <div className="md:hidden">
        <div className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-card" aria-label="Şəkillər" data-testid="gallery-mobile"
          onScroll={(e) => {
            const el = e.currentTarget;
            const index = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
            if (index !== active) setActive(Math.min(list.length - 1, index));
          }}>
          {list.map((img, i) => (
            <div key={i} className="aspect-vehicle w-full shrink-0 snap-center overflow-hidden rounded-card bg-sunken">
              <ListingImage src={img.url} alt={`${title} — ${UI.photoOf.toLowerCase()} ${i + 1}`} priority={i === 0} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-muted" aria-live="polite" data-testid="gallery-counter">{active + 1} / {list.length}</p>
      </div>
      {/* Desktop / tablet */}
      <div className="hidden md:block">
        <div className="aspect-vehicle w-full overflow-hidden rounded-card bg-sunken" data-testid="gallery-main">
          <ListingImage src={current.url} alt={`${title} — ${UI.photoOf.toLowerCase()} ${active + 1}`} priority />
        </div>
        {list.length > 1 ? (
          <ul className="mt-3 grid grid-cols-6 gap-2" aria-label="Kiçik şəkillər">
            {list.map((img, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-label={`${UI.photoOf} ${i + 1}`}
                  aria-current={i === active ? "true" : undefined}
                  onClick={() => setActive(i)}
                  className={`aspect-vehicle w-full overflow-hidden rounded-md border-2 transition-colors ${i === active ? "border-primary" : "border-transparent hover:border-line-strong"}`}
                >
                  <ListingImage src={img.url} alt="" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
