import type { HTMLAttributes, ReactNode } from "react";

/**
 * Standard feedback notice. Callers pass the accessibility role their
 * flow already established (`alert` for errors/conflicts, `status`
 * for confirmations) — this component never downgrades semantics.
 */

const TONES = {
  info: "border-info-line bg-info-soft text-info-deep",
  success: "border-success-line bg-success-soft text-success-deep",
  warning: "border-warning-line bg-warning-soft text-warning-deep",
  danger: "border-danger-line bg-danger-soft text-danger-deep",
} as const;

export type NoticeTone = keyof typeof TONES;

export function Notice({
  tone,
  children,
  className = "",
  ...rest
}: { tone: NoticeTone; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-control border px-3 py-2.5 text-sm leading-5 ${TONES[tone]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
