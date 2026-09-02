import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Operational data table for staff list pages. ARIA table semantics
 * over a CSS grid so rows can stay full-row links (a real <tr> cannot
 * wrap an anchor); columns are given per page via a grid template
 * class. On narrow screens the table scrolls inside its own
 * container — the page never scrolls horizontally.
 */

export function StaffTable({
  columns,
  grid,
  minWidth = "min-w-[640px]",
  children,
  testid,
  label,
}: {
  columns: string[];
  /** grid-template class, e.g. "grid-cols-[2fr_1fr_1fr_8rem]" */
  grid: string;
  minWidth?: string;
  children: ReactNode;
  testid?: string;
  label: string;
}) {
  return (
    <div className="overflow-x-auto rounded-staff border border-line bg-raised">
      <div role="table" aria-label={label} className={minWidth} data-testid={testid}>
        <div role="row" className={`grid items-center gap-x-4 border-b border-line bg-sunken px-3 py-2 ${grid}`}>
          {columns.map((column) => (
            <span key={column} role="columnheader" className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-slate-strong">
              {column}
            </span>
          ))}
        </div>
        <div role="rowgroup">{children}</div>
      </div>
    </div>
  );
}

export function StaffRow({
  href,
  grid,
  children,
  testid,
  ...rest
}: {
  href?: string;
  grid: string;
  children: ReactNode;
  testid?: string;
} & Record<`data-${string}`, string | undefined>) {
  const className = `grid items-center gap-x-4 border-b border-line px-3 py-2.5 text-[12.5px] last:border-b-0 ${grid} ${
    href !== undefined ? "transition-colors duration-150 hover:bg-row-hover" : ""
  }`;
  if (href !== undefined) {
    return (
      <Link role="row" href={href} className={className} data-testid={testid} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <div role="row" className={className} data-testid={testid} {...rest}>
      {children}
    </div>
  );
}

export function StaffCell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span role="cell" className={`min-w-0 truncate text-ink ${className}`}>
      {children}
    </span>
  );
}
