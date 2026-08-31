import type { HTMLAttributes, ReactNode } from "react";

/**
 * Unified terminal-state panel (payment results, submission results,
 * unavailable/blocked states, decision successes). Visual layer only:
 * each flow keeps its own state machine and passes the outcome in.
 */

const TONE_ICON: Record<string, { ring: string; glyph: ReactNode }> = {
  success: {
    ring: "bg-success-soft text-success-deep",
    glyph: <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />,
  },
  info: {
    ring: "bg-info-soft text-info-deep",
    glyph: <path d="M12 8v5m0 3.5v.5" strokeLinecap="round" />,
  },
  pending: {
    ring: "bg-warning-soft text-warning-deep",
    glyph: <path d="M12 7v5l3 3M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z" strokeLinecap="round" />,
  },
  warning: {
    ring: "bg-warning-soft text-warning-deep",
    glyph: <path d="M12 8v5m0 3.5v.5M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />,
  },
  danger: {
    ring: "bg-danger-soft text-danger-deep",
    glyph: <path d="M8 8l8 8m0-8-8 8M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z" strokeLinecap="round" />,
  },
  neutral: {
    ring: "bg-sunken text-slate-strong",
    glyph: <path d="M12 8v5m0 3.5v.5" strokeLinecap="round" />,
  },
};

export type ResultTone = keyof typeof TONE_ICON;

export function ResultPanel({
  tone,
  title,
  hint,
  actions,
  children,
  className = "",
  ...rest
}: {
  tone: ResultTone;
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const icon = TONE_ICON[tone];
  return (
    <div className={`mx-auto max-w-xl py-14 text-center ${className}`} {...rest}>
      <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${icon.ring}`} aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {icon.glyph}
        </svg>
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight text-navy">{title}</h1>
      {hint !== undefined ? <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">{hint}</p> : null}
      {children}
      {actions !== undefined ? <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </div>
  );
}
