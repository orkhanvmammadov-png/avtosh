import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/shared/logout-button";
import { STAFF, UI } from "@/lib/marketplace/labels";
import { requireStaffPage, staffRoleLabel } from "@/lib/moderator/staff-page";

export const metadata: Metadata = {
  title: `${STAFF.portal} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Dedicated staff shell: separate from the public header, no public
 * navigation, no admin controls. The guard runs here AND in every
 * page below it; the APIs re-authorize independently.
 */
export default async function ModeratorLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireStaffPage("/moderator/elanlar");
  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-40 border-b border-line bg-navy text-white">
        <div className="mx-auto flex h-14 max-w-(--container-content) items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-4">
            <Link href="/moderator/elanlar" className="text-lg font-extrabold tracking-tight">
              {UI.brand} <span className="font-medium text-white/70">{STAFF.portal}</span>
            </Link>
            <nav aria-label={STAFF.portal} className="hidden items-center gap-1 sm:flex">
              <Link
                href="/moderator/elanlar"
                className="rounded-lg px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
                data-testid="staff-nav-queue"
              >
                {STAFF.queue}
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold" data-testid="staff-role">
              {staffRoleLabel(auth.roles)}
            </span>
            <LogoutButton className="text-white hover:bg-white/10" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-(--container-content) px-4 pb-16">{children}</main>
    </div>
  );
}
