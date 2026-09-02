import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/shared/logout-button";
import { StaffDrawer } from "@/components/staff/staff-drawer";
import { UI } from "@/lib/marketplace/labels";

/**
 * Shared operational shell for the staff portals (approved staff
 * design): navy application bar + fixed navy left sidebar at desk+
 * (170px, 190px at xl), drawer navigation below desk, denser paper
 * content. Deliberately NOT the public marketing chrome. Route guards
 * stay in the portal layouts/pages — this component is presentation
 * only.
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
      <header className="sticky top-0 z-40 bg-navy text-white">
        <div className="flex h-12 items-center justify-between gap-3 border-b border-navy-border px-3 md:px-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <StaffDrawer nav={nav} portalLabel={portalLabel} />
            <Link href={homeHref} className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden="true" className={`h-5 w-1.5 shrink-0 rounded-pill ${accent.bar}`} />
              <span className="truncate text-base font-extrabold tracking-tight">
                {UI.brand} <span className="font-medium text-on-navy-muted">{portalLabel}</span>
              </span>
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {extra}
            <span className={`rounded-staff px-2 py-1 text-xs font-semibold ${accent.chip}`} data-testid={roleChipTestid}>
              {roleChip}
            </span>
            <LogoutButton className="text-white hover:bg-white/10" />
          </div>
        </div>
      </header>
      <aside className="fixed bottom-0 left-0 top-12 z-30 hidden w-[170px] overflow-y-auto border-r border-navy-border bg-navy py-3 desk:block xl:w-[190px]">
        <nav aria-label={portalLabel}>
          <ul className="flex flex-col gap-0.5 px-2">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-staff px-3 py-2 text-[12.5px] font-medium text-on-navy-muted transition-colors duration-150 hover:bg-white/5 hover:text-white"
                  data-testid={item.testid}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main id="main" className="min-w-0 px-3 pb-16 md:px-4 desk:ml-[170px] desk:px-6 xl:ml-[190px]">
        {children}
      </main>
    </div>
  );
}
