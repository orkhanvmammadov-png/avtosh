import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/shared/logout-button";
import { UI } from "@/lib/marketplace/labels";

/**
 * Shared operational shell for the staff portals. Deliberately NOT
 * the public marketing chrome: navy application bar, role accent,
 * horizontally scrollable nav with an edge-fade affordance, denser
 * content container. Route guards stay in the portal layouts/pages —
 * this component is presentation only.
 */

const ACCENTS = {
  moderation: { bar: "bg-staff-moderation", chip: "bg-staff-moderation/15 text-staff-moderation" },
  admin: { bar: "bg-staff-admin", chip: "bg-staff-admin/15 text-staff-admin" },
} as const;

export interface StaffNavItem {
  href: string;
  label: string;
  testid?: string;
}

export function StaffShell({
  role,
  portalLabel,
  homeHref,
  nav,
  roleChip,
  roleChipTestid,
  extra,
  children,
}: {
  role: keyof typeof ACCENTS;
  portalLabel: string;
  homeHref: string;
  nav: StaffNavItem[];
  roleChip: string;
  roleChipTestid: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const accent = ACCENTS[role];
  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-40 bg-navy text-white shadow-raised">
        <div className="mx-auto flex h-14 max-w-(--container-content) items-center justify-between gap-4 px-4">
          <Link href={homeHref} className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className={`h-6 w-1.5 shrink-0 rounded-full ${accent.bar}`} />
            <span className="truncate text-lg font-extrabold tracking-tight">
              {UI.brand} <span className="font-medium text-white/60">{portalLabel}</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {extra}
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${accent.chip}`} data-testid={roleChipTestid}>
              {roleChip}
            </span>
            <LogoutButton className="text-white hover:bg-white/10" />
          </div>
        </div>
        <div className="relative border-t border-white/10">
          {/* edge fade signals horizontal scrollability on narrow screens */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-navy to-transparent md:hidden" />
          <nav aria-label={portalLabel} className="no-scrollbar mx-auto max-w-(--container-content) overflow-x-auto px-4">
            <ul className="flex gap-1 py-1.5">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-2.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    data-testid={item.testid}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-(--container-content) px-4 pb-16">
        {children}
      </main>
    </div>
  );
}
