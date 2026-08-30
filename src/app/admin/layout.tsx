import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/shared/logout-button";
import { ADMIN, UI } from "@/lib/marketplace/labels";
import { isSuperAdmin, requireAdminPage } from "@/lib/admin/admin-page";

export const metadata: Metadata = {
  title: `${ADMIN.panel} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string; testid: string }[] = [
  { href: "/admin", label: ADMIN.dashboard, testid: "nav-dashboard" },
  { href: "/admin/istifadeciler", label: ADMIN.users, testid: "nav-users" },
  { href: "/admin/emekdaslar", label: ADMIN.staff, testid: "nav-staff" },
  { href: "/admin/elanlar", label: ADMIN.listings, testid: "nav-listings" },
  { href: "/admin/odenisler", label: ADMIN.payments, testid: "nav-payments" },
  { href: "/admin/tesviq-paketleri", label: ADMIN.packages, testid: "nav-packages" },
  { href: "/admin/kataloq", label: ADMIN.catalog, testid: "nav-catalog" },
  { href: "/admin/hesabatlar", label: ADMIN.reports, testid: "nav-reports" },
  { href: "/admin/audit", label: ADMIN.audit, testid: "nav-audit" },
  { href: "/admin/tenzimlemeler", label: ADMIN.settings, testid: "nav-settings" },
];

/** Dedicated admin shell — separate from public and moderator UIs. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAdminPage("/admin");
  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-40 border-b border-line bg-navy text-white">
        <div className="mx-auto flex h-14 max-w-(--container-content) items-center justify-between gap-4 px-4">
          <Link href="/admin" className="text-lg font-extrabold tracking-tight">
            {UI.brand} <span className="font-medium text-white/70">{ADMIN.panel}</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/moderator/elanlar" className="hidden rounded-lg px-2 py-1 text-xs font-medium text-white/80 hover:bg-white/10 sm:inline-flex">
              {ADMIN.moderatorPortal}
            </Link>
            <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold" data-testid="admin-role">
              {isSuperAdmin(auth) ? "Super Admin" : "Admin"}
            </span>
            <LogoutButton className="text-white hover:bg-white/10" />
          </div>
        </div>
        <nav aria-label={ADMIN.panel} className="mx-auto max-w-(--container-content) overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-2.5 text-xs font-medium text-white/85 hover:bg-white/10"
                  data-testid={item.testid}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-(--container-content) px-4 pb-16">{children}</main>
    </div>
  );
}
