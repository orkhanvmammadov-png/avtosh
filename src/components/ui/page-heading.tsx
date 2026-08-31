import type { ReactNode } from "react";

/** Standard page header row: title/subtitle left, actions right. */
export function PageHeading({
  title,
  subtitle,
  actions,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-navy">{title}</h1>
        {subtitle !== undefined ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions !== undefined ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
