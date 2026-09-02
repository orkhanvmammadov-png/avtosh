import type { Metadata } from "next";
import Link from "next/link";
import { StaffShell } from "@/components/staff/staff-shell";
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

/**
 * Admin console shell over the shared staff foundation. The guard
 * runs here AND in every page below; APIs re-authorize independently.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAdminPage("/admin");
  return (
    <StaffShell
      role="admin"
      portalLabel={ADMIN.panel}
      homeHref="/admin"
      nav={NAV}
      roleChip={isSuperAdmin(auth) ? "Super Admin" : "Admin"}
      roleChipTestid="admin-role"
      extra={
        <Link
          href="/moderator/elanlar"
          className="hidden rounded-md px-2 py-1 text-xs font-medium text-white/80 hover:bg-raised/10 sm:inline-flex"
        >
          {ADMIN.moderatorPortal}
        </Link>
      }
    >
      {children}
    </StaffShell>
  );
}
