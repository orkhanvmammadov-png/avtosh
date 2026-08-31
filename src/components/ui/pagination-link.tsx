import Link from "next/link";
import type { ReactNode } from "react";

/** Standard keyset "next page" link for server-paginated staff lists. */
export function PaginationLink({
  href,
  children,
  testid,
}: {
  href: string;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testid}
      className="inline-flex min-h-12 items-center gap-2 rounded-control border border-line bg-raised px-4 text-sm font-medium text-navy transition-colors hover:border-line-strong hover:bg-surface"
    >
      {children}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
