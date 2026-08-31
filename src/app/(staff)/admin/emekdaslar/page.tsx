import { PageHeading } from "@/components/ui/page-heading";
import { StatusChip } from "@/components/ui/status-chip";
import { StaffCell, StaffRow, StaffTable } from "@/components/staff/staff-table";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminStaff } from "@/services/admin";

export const dynamic = "force-dynamic";

const GRID = "grid-cols-[10rem_1fr_14rem_8rem]";

/** Staff overview; role changes happen on the user detail page. */
export default async function AdminStaffPage() {
  await requireAdminPage("/admin/emekdaslar");
  const staff = await adminStaff();
  return (
    <div className="py-6" data-testid="admin-staff-page">
      <PageHeading title={ADMIN.staff} />
      <div className="mt-4">
        <StaffTable
          label={ADMIN.staff}
          testid="admin-staff"
          grid={GRID}
          minWidth="min-w-[640px]"
          columns={["Telefon", "Ad", ADMIN.role, ADMIN.status]}
        >
          {staff.map((user) => (
            <StaffRow key={user.id} href={`/admin/istifadeciler/${user.id}`} grid={GRID} testid="staff-row">
              <StaffCell className="font-semibold">{user.phoneMasked}</StaffCell>
              <StaffCell className="text-muted">{user.displayName ?? "—"}</StaffCell>
              <StaffCell>
                <span className="flex flex-wrap gap-1">
                  {user.roles.filter((r) => r !== "USER").map((role) => (
                    <StatusChip key={role} tone="info">{role}</StatusChip>
                  ))}
                </span>
              </StaffCell>
              <StaffCell>
                {user.status === "BLOCKED" ? <StatusChip tone="danger">{ADMIN.blocked}</StatusChip> : <StatusChip tone="success">{ADMIN.active}</StatusChip>}
              </StaffCell>
            </StaffRow>
          ))}
        </StaffTable>
      </div>
    </div>
  );
}
