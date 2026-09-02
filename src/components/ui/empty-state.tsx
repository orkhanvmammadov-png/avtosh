import type { ReactNode } from "react";

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div role="status" className="rounded-card border border-dashed border-line-strong bg-raised px-6 py-12 text-center">
      <p className="text-base font-bold text-ink md:text-lg">{title}</p>
      {hint ? <p className="mt-2 text-sm text-slate-strong">{hint}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
