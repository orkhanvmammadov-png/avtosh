import type { ReactNode } from "react";

/**
 * Overlay badge for listing imagery (public cards/detail). Promotion
 * identity: Premium = navy + gold, Boost = boost blue. Always text,
 * never color-only.
 */
const TONES = {
  premium: "bg-navy text-premium ring-1 ring-inset ring-premium/50",
  boosted: "bg-boost text-white",
  sold: "bg-danger text-white",
  expired: "bg-slate-strong text-white",
  neutral: "bg-sunken text-navy",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide shadow-card ${TONES[tone]}`}>
      {children}
    </span>
  );
}
