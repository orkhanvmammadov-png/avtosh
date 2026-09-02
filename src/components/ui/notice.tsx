import type { HTMLAttributes, ReactNode } from "react";

/**
 * Approved inline notice (components.md): borderless tinted message.
 * `rule` adds the danger/warning left rule used by banners (e.g. the
 * wizard correction banner). Callers pass the accessibility role
 * their flow already established — semantics are never downgraded.
 */

const TONES = {
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
} as const;

const RULES = {
  info: "border-l-4 border-info",
  success: "border-l-4 border-success",
  warning: "border-l-4 border-warning",
  danger: "border-l-4 border-danger",
} as const;

export type NoticeTone = keyof typeof TONES;

export function Notice({
  tone,
  rule = false,
  children,
  className = "",
  ...rest
}: { tone: NoticeTone; rule?: boolean; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-control px-3 py-2.5 text-sm leading-relaxed ${TONES[tone]} ${rule ? RULES[tone] : ""} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
