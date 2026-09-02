import type { ReactNode } from "react";

/**
 * Overlay badge for listing imagery. Promotion identities live in
 * PromotionBadge; this covers the neutral/lifecycle overlays.
 */
const TONES = {
  premium: "bg-navy text-premium",
  boosted: "bg-boost-soft text-boost",
  sold: "bg-navy text-white",
  expired: "bg-sunken text-slate-strong",
  neutral: "bg-sunken text-ink",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-[5px] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TONES[tone]}`}>
      {children}
    </span>
  );
}
