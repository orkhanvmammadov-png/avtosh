"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ListingImage } from "@/components/shared/listing-image";
import { UI } from "@/lib/marketplace/labels";

export interface GalleryImage {
  url: string | null;
  width: number | null;
  height: number | null;
  isPrimary: boolean;
}

/** Approved O.7 thumbnail cap at desktop (components.md): 6 visible tiles. */
const THUMB_CAP = 6;

/**
 * O.7 Direction 1A gallery. ONE active index owns the hero, the
 * thumbnail rail, the arrows, the counter and the fullscreen layer —
 * no per-breakpoint state forks. Signed URLs are used as-is, never
 * rebuilt client-side; the fullscreen viewer is a presentation-only
 * overlay over the same image set (no image API).
 *
 * Desktop: 16:10 hero with boundary-disabled arrow circles + counter
 * chip, dark 4:3 thumbnails capped at 6 with a "+n" tile, keyboard
 * ←/→ on the focusable stage. Mobile: existing scroll-snap strip +
 * counter (final 390 treatment lands in the O.7 mobile gate).
 */
export function Gallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const list = images.length > 0 ? images : [{ url: null, width: null, height: null, isPrimary: true }];
  const [active, setActive] = useState(Math.max(0, list.findIndex((i) => i.isPrimary)));
  const [fullscreen, setFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const current = list[active] ?? list[0];
  const many = list.length > 1;

  const step = useCallback(
    (delta: number) => {
      setActive((i) => Math.min(list.length - 1, Math.max(0, i + delta)));
    },
    [list.length],
  );

  function onStageKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    }
  }

  // Fullscreen layer: Esc closes and focus returns to the stage.
  useEffect(() => {
    if (!fullscreen) return;
    overlayRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        setFullscreen(false);
        stageRef.current?.focus();
      } else if (event.key === "ArrowLeft") {
        step(-1);
      } else if (event.key === "ArrowRight") {
        step(1);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [fullscreen, step]);

  const arrow =
    "absolute top-1/2 z-10 flex h-[34px] w-[34px] -translate-y-1/2 items-center justify-center rounded-full bg-white/[.92] text-[15px] font-semibold text-ink shadow-sm transition-opacity duration-150 disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";
  const counterChip =
    "rounded-[5px] bg-[rgba(20,26,34,0.8)] px-2 py-[3px] text-[10.5px] font-medium text-white";
  const visibleThumbs = list.length > THUMB_CAP ? THUMB_CAP - 1 : list.length;

  return (
    <div data-testid="gallery">
      {/* Mobile strip (final 390 treatment comes in the mobile gate). */}
      <div className="md:hidden">
        <div className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-card" aria-label="Şəkillər" data-testid="gallery-mobile"
          onScroll={(e) => {
            const el = e.currentTarget;
            const index = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
            if (index !== active) setActive(Math.min(list.length - 1, index));
          }}>
          {list.map((img, i) => (
            <div key={i} className="aspect-vehicle w-full shrink-0 snap-center overflow-hidden rounded-card bg-navy-raised">
              <ListingImage src={img.url} alt={`${title} — ${UI.photoOf.toLowerCase()} ${i + 1}`} priority={i === 0} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-xs text-on-navy-muted" aria-live="polite" data-testid="gallery-counter">{active + 1} / {list.length}</p>
      </div>

      {/* Desktop / tablet stage */}
      <div className="hidden md:block">
        <div
          ref={stageRef}
          tabIndex={0}
          role="group"
          aria-label={`Şəkillər — ${active + 1} / ${list.length}`}
          onKeyDown={onStageKeyDown}
          className="relative rounded-[12px] focus:outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
        >
          <div className="aspect-gallery w-full overflow-hidden rounded-[12px] bg-navy-raised" data-testid="gallery-main">
            <ListingImage src={current.url} alt={`${title} — ${UI.photoOf.toLowerCase()} ${active + 1}`} priority />
          </div>
          {many ? (
            <>
              <button
                type="button"
                aria-label="Əvvəlki şəkil"
                disabled={active === 0}
                onClick={() => step(-1)}
                className={`${arrow} left-3`}
                data-testid="gallery-prev"
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Növbəti şəkil"
                disabled={active === list.length - 1}
                onClick={() => step(1)}
                className={`${arrow} right-3`}
                data-testid="gallery-next"
              >
                ›
              </button>
              <span aria-hidden="true" className={`pointer-events-none absolute bottom-2.5 right-2.5 ${counterChip}`} data-testid="gallery-hero-counter">
                {active + 1} / {list.length}
              </span>
            </>
          ) : null}
        </div>
        {many ? (
          <ul className="mt-2 grid grid-cols-6 gap-2" aria-label="Kiçik şəkillər">
            {list.slice(0, visibleThumbs).map((img, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-label={`${UI.photoOf} ${i + 1}`}
                  aria-current={i === active ? "true" : undefined}
                  onClick={() => setActive(i)}
                  data-testid={`gallery-thumb-${i}`}
                  className={`aspect-vehicle w-full overflow-hidden rounded-lg border border-navy-border bg-navy-raised transition-[outline] duration-150 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 ${
                    i === active ? "outline outline-2 outline-offset-1 outline-green-dark" : ""
                  }`}
                >
                  <ListingImage src={img.url} alt="" />
                </button>
              </li>
            ))}
            {list.length > THUMB_CAP ? (
              <li>
                <button
                  type="button"
                  aria-label={`Daha ${list.length - visibleThumbs} şəkil`}
                  onClick={() => {
                    setActive(visibleThumbs);
                    setFullscreen(true);
                  }}
                  data-testid="gallery-more"
                  className="relative aspect-vehicle w-full overflow-hidden rounded-lg border border-navy-border bg-navy-raised focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  <ListingImage src={list[visibleThumbs]?.url ?? null} alt="" />
                  <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-[rgba(20,26,34,0.6)] text-[12px] font-semibold text-white">
                    +{list.length - visibleThumbs}
                  </span>
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      {/* Fullscreen — presentation-only layer over the same image set. */}
      {fullscreen ? (
        <div
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Şəkillər — ${active + 1} / ${list.length}`}
          tabIndex={-1}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(20,26,34,0.96)] focus:outline-none"
          data-testid="gallery-fullscreen"
        >
          <button
            type="button"
            aria-label="Bağla"
            onClick={() => {
              setFullscreen(false);
              stageRef.current?.focus();
            }}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/[.92] text-ink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            data-testid="gallery-fullscreen-close"
          >
            <X size={18} aria-hidden="true" />
          </button>
          <div className="max-h-[86vh] w-full max-w-6xl px-14">
            <div className="overflow-hidden rounded-[12px]">
              <ListingImage src={current.url} alt={`${title} — ${UI.photoOf.toLowerCase()} ${active + 1}`} />
            </div>
          </div>
          {many ? (
            <>
              <button type="button" aria-label="Əvvəlki şəkil" disabled={active === 0} onClick={() => step(-1)} className={`${arrow} left-4`}>
                ‹
              </button>
              <button type="button" aria-label="Növbəti şəkil" disabled={active === list.length - 1} onClick={() => step(1)} className={`${arrow} right-4`}>
                ›
              </button>
              <span aria-hidden="true" className={`absolute bottom-5 right-5 ${counterChip}`}>
                {active + 1} / {list.length}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
