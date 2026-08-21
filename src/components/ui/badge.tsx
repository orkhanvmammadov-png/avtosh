import type { ReactNode } from "react";

const TONES = {
  premium: "bg-navy text-white",
  boosted: "bg-amber-100 text-amber-900 border border-amber-300",
  sold: "bg-danger text-white",
  expired: "bg-muted text-white",
  neutral: "bg-line text-navy",
} as const;

/** Status/promo badge — always text, never color-only. */
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${TONES[tone]}`}>
      {children}
    </span>
  );
}
