import type { ReactNode } from "react";

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div role="status" className="rounded-card border border-dashed border-line bg-white px-6 py-12 text-center">
      <p className="text-lg font-semibold text-navy">{title}</p>
      {hint ? <p className="mt-2 text-sm text-muted">{hint}</p> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
