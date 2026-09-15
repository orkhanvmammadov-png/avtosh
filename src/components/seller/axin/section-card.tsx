"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { SELLER } from "@/lib/marketplace/labels";

export type StageState = "upcoming" | "current" | "visited" | "attention";

/**
 * O.10 journey stage card (states.md — semantics fixed):
 * UPCOMING  ○ 55%-opacity row, NON-interactive — never shows ✓ even
 *           when every field is optional (visited ≠ valid).
 * CURRENT   open card with the 2px green border.
 * VISITED   ✓ collapsed row + one-line summary + Dəyiş — means the
 *           stage was reached under the strict sequential journey,
 *           NOT that optional data was entered.
 * ATTENTION visited AND required data invalid — red dot, red hairline,
 *           inline message, "Düzəlt".
 * All states carry icon + text (never color-only). The O.9 card visual
 * system is preserved; only state semantics are new.
 */
export function SectionCard({
  sectionKey,
  index,
  title,
  state,
  summary,
  attentionMessage,
  onOpen,
  onContinue,
  continueDisabled = false,
  continueLabel = SELLER.continueCta,
  footerStart,
  children,
}: {
  sectionKey: string;
  index: number;
  title: string;
  state: StageState;
  summary: string | null;
  /** Inline message for the ATTENTION row (states.md). */
  attentionMessage?: string | null;
  onOpen: () => void;
  /** Renders the sequential "Davam et" footer action when provided. */
  onContinue?: () => void;
  continueDisabled?: boolean;
  continueLabel?: string;
  /** Left footer slot (autosave chip). */
  footerStart?: ReactNode;
  children: ReactNode;
}) {
  if (state === "upcoming") {
    return (
      <div
        aria-disabled="true"
        data-testid={`axin-section-${sectionKey}`}
        data-state="upcoming"
        className="flex min-h-11 w-full items-center gap-3 rounded-[12px] border border-[#E3E0D8] bg-raised px-4 py-3 opacity-55"
      >
        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
          <span className="h-4 w-4 rounded-full border-[1.5px] border-line-strong" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
          {index}. {title}
        </span>
      </div>
    );
  }

  if (state !== "current") {
    const attention = state === "attention";
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid={`axin-section-${sectionKey}`}
        data-state={attention ? "attention" : "visited"}
        className={`flex min-h-11 w-full items-center gap-3 rounded-[12px] border bg-raised px-4 py-3 text-left transition-colors duration-150 ${
          attention ? "border-[#B3261E]" : "border-[#E3E0D8] hover:border-line-strong"
        }`}
      >
        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
          {attention ? (
            <span className="h-2.5 w-2.5 rounded-full bg-danger" />
          ) : (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E7F2EC] text-[#147A4E]">
              <Check size={12} strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">
            {index}. {title}
          </span>
          {attention && attentionMessage != null && attentionMessage !== "" ? (
            <span className="block truncate text-xs text-danger" data-testid={`axin-attention-${sectionKey}`}>
              {attentionMessage}
            </span>
          ) : summary !== null && summary !== "" ? (
            <span className="block truncate text-xs text-muted" data-testid={`axin-summary-${sectionKey}`}>
              {summary}
            </span>
          ) : null}
        </span>
        <span className={`shrink-0 text-[12.5px] font-semibold ${attention ? "text-danger" : "text-primary"}`}>
          {attention ? SELLER.fixCta : SELLER.sectionEdit}
        </span>
      </button>
    );
  }

  return (
    <section
      aria-label={title}
      aria-current="step"
      data-testid={`axin-section-${sectionKey}`}
      data-state="open"
      className="rounded-[12px] border-2 border-[#147A4E] bg-raised p-4"
    >
      <h2
        tabIndex={-1}
        data-testid={`axin-heading-${sectionKey}`}
        className="text-[14px] font-bold tracking-[-0.01em] text-ink outline-none"
      >
        {index}. {title}
      </h2>
      <div className="mt-3">{children}</div>
      {onContinue !== undefined || footerStart !== undefined ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0">{footerStart}</div>
          {onContinue !== undefined ? (
            // ONE instance for every tier: the approved sticky h48
            // safe-area bar below desk (only one card is ever open, so
            // exactly one bar exists), the in-card button at desk+.
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised px-3.5 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] desk:static desk:border-0 desk:bg-transparent desk:p-0">
              <button
                type="button"
                onClick={onContinue}
                disabled={continueDisabled}
                data-testid={`axin-continue-${sectionKey}`}
                className="inline-flex h-12 w-full items-center justify-center rounded-control bg-primary px-5 text-[13px] font-bold text-white transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 desk:h-10 desk:w-auto"
              >
                {continueLabel}
                <span aria-hidden="true" className="ml-1.5">→</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
