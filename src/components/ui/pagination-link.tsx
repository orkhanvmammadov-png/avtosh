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
      className="inline-flex min-h-10 items-center gap-2 rounded-control border border-line-strong bg-raised px-4 text-[13.5px] font-semibold text-ink transition-colors duration-150 hover:border-primary hover:text-primary max-md:min-h-12"
    >
      {children}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}
