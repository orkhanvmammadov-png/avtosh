import type { Metadata } from "next";
import { StaffShell } from "@/components/staff/staff-shell";
import { STAFF, UI } from "@/lib/marketplace/labels";
import { requireStaffPage, staffRoleLabel } from "@/lib/moderator/staff-page";

export const metadata: Metadata = {
  title: `${STAFF.portal} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Moderation workbench shell over the shared staff foundation — no
 * public navigation, no admin controls. The guard runs here AND in
 * every page below; APIs re-authorize independently.
 */
export default async function ModeratorLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireStaffPage("/moderator/elanlar");
  return (
    <StaffShell
      role="moderation"
      portalLabel={STAFF.portal}
      homeHref="/moderator/elanlar"
      nav={[{ href: "/moderator/elanlar", label: STAFF.queue, testid: "staff-nav-queue" }]}
      roleChip={staffRoleLabel(auth.roles)}
      roleChipTestid="staff-role"
    >
      {children}
    </StaffShell>
  );
}
