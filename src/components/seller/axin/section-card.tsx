"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { SELLER } from "@/lib/marketplace/labels";

/**
 * O.9 AXIN section card (layout.md): white r12 card, active card
 * carries the 2px green border; collapsed cards are one-line rows
 * (~h44) with a status glyph (○ / ✓ / red dot), a one-line summary
 * and "Dəyiş". One card is open at a time; completing is
 * non-destructive and reopening via the summary is always allowed.
 */
export function SectionCard({
  sectionKey,
  index,
  title,
  open,
  complete,
  needsAttention = false,
  summary,
  onOpen,
  onComplete,
  completeDisabled = false,
  footerStart,
  children,
}: {
  sectionKey: string;
  index: number;
  title: string;
  open: boolean;
  complete: boolean;
  needsAttention?: boolean;
  summary: string | null;
  onOpen: () => void;
  /** Rendered as the "Bölməni tamamla" footer action when provided. */
  onComplete?: () => void;
  completeDisabled?: boolean;
  /** Left footer slot (autosave chip). */
  footerStart?: ReactNode;
  children: ReactNode;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={`axin-section-${sectionKey}`}
        data-state={needsAttention ? "attention" : complete ? "complete" : "incomplete"}
        className="flex min-h-11 w-full items-center gap-3 rounded-[12px] border border-[#E3E0D8] bg-raised px-4 py-3 text-left transition-colors duration-150 hover:border-line-strong"
      >
        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
          {needsAttention ? (
            <span className="h-2.5 w-2.5 rounded-full bg-danger" />
          ) : complete ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E7F2EC] text-[#147A4E]">
              <Check size={12} strokeWidth={3} />
            </span>
          ) : (
            <span className="h-4 w-4 rounded-full border-[1.5px] border-line-strong" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">
            {index}. {title}
          </span>
          {summary !== null && summary !== "" ? (
            <span className="block truncate text-xs text-muted" data-testid={`axin-summary-${sectionKey}`}>
              {summary}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[12.5px] font-semibold text-primary">{SELLER.sectionEdit}</span>
      </button>
    );
  }

  return (
    <section
      aria-label={title}
      data-testid={`axin-section-${sectionKey}`}
      data-state="open"
      className="rounded-[12px] border-2 border-[#147A4E] bg-raised p-4"
    >
      <h2 className="text-[14px] font-bold tracking-[-0.01em] text-ink">
        {index}. {title}
      </h2>
      <div className="mt-3">{children}</div>
      {onComplete !== undefined || footerStart !== undefined ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0">{footerStart}</div>
          {onComplete !== undefined ? (
            <button
              type="button"
              onClick={onComplete}
              disabled={completeDisabled}
              data-testid={`axin-complete-${sectionKey}`}
              className="inline-flex h-10 items-center justify-center rounded-control bg-primary px-5 text-[13px] font-bold text-white transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {SELLER.sectionComplete}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
