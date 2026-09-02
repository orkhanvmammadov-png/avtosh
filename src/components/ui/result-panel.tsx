import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, Check, Clock, Info, X } from "lucide-react";

/**
 * Approved full-page outcome panel (components.md): 44px icon circle
 * + title + sub + actions, max-width 400 centered. Visual layer only:
 * each flow keeps its own state machine and passes the outcome in.
 */

const TONE: Record<string, { ring: string; icon: ReactNode }> = {
  success: { ring: "bg-success-soft text-success", icon: <Check size={22} strokeWidth={2.5} /> },
  info: { ring: "bg-info-soft text-info", icon: <Info size={22} /> },
  pending: { ring: "bg-warning-soft text-warning", icon: <Clock size={22} /> },
  warning: { ring: "bg-warning-soft text-warning", icon: <AlertTriangle size={22} /> },
  danger: { ring: "bg-danger-soft text-danger", icon: <X size={22} strokeWidth={2.5} /> },
  neutral: { ring: "bg-sunken text-slate-strong", icon: <Info size={22} /> },
};

export type ResultTone = keyof typeof TONE;

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
  const t = TONE[tone];
  return (
    <div className={`mx-auto max-w-[400px] py-14 text-center ${className}`} {...rest}>
      <span className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full ${t.ring}`} aria-hidden="true">
        {t.icon}
      </span>
      <h1 className="mt-5 text-xl font-bold tracking-[-0.01em] text-ink md:text-2xl">{title}</h1>
      {hint !== undefined ? <p className="mt-3 text-sm leading-relaxed text-slate-strong">{hint}</p> : null}
      {children}
      {actions !== undefined ? <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </div>
  );
}
