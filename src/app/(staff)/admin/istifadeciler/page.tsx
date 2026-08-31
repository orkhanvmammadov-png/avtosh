import { PageHeading } from "@/components/ui/page-heading";
import { PaginationLink } from "@/components/ui/pagination-link";
import { StatusChip } from "@/components/ui/status-chip";
import { StaffCell, StaffRow, StaffTable } from "@/components/staff/staff-table";
import { controlClasses } from "@/components/ui/controls";
import { buttonClasses } from "@/components/ui/button";
import { formatDateAz } from "@/lib/format";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminUsers } from "@/services/admin";

export const dynamic = "force-dynamic";

const GRID = "grid-cols-[10rem_1fr_8rem_12rem_11rem]";

/** User administration list: scoped search, keyset pagination. */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; cursor?: string }>;
}) {
  await requireAdminPage("/admin/istifadeciler");
  const params = await searchParams;
  const phone = params.phone?.replace(/[^+0-9]/g, "").slice(0, 16);
  const result = await adminUsers({
    phone: phone !== undefined && phone.length >= 2 ? phone : undefined,
    cursor: params.cursor,
  });
  return (
    <div className="py-6" data-testid="admin-users-page">
      <PageHeading title={ADMIN.users} />
      <form method="get" className="mt-4 flex gap-2" role="search">
        <input
          type="search"
          name="phone"
          defaultValue={phone ?? ""}
          placeholder={ADMIN.phoneSearch}
          className={controlClasses("w-64 max-w-full")}
          data-testid="user-phone-search"
        />
        <button type="submit" className={buttonClasses("primary")}>{ADMIN.search}</button>
      </form>
      {result.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted" data-testid="users-empty">{ADMIN.empty}</p>
      ) : (
        <div className="mt-4">
          <StaffTable
            label={ADMIN.users}
            testid="admin-users"
            grid={GRID}
            minWidth="min-w-[760px]"
            columns={["Telefon", "Ad", ADMIN.status, ADMIN.role, "Elan / Qeydiyyat"]}
          >
            {result.items.map((user) => (
              <StaffRow key={user.id} href={`/admin/istifadeciler/${user.id}`} grid={GRID} testid="admin-user-row">
                <StaffCell className="font-semibold">{user.phoneMasked}</StaffCell>
                <StaffCell className="text-muted">{user.displayName ?? "—"}</StaffCell>
                <StaffCell>
                  <StatusChip tone={user.status === "BLOCKED" ? "danger" : "success"}>
                    {user.status === "BLOCKED" ? ADMIN.blocked : ADMIN.active}
                  </StatusChip>
                </StaffCell>
                <StaffCell>
                  <span className="flex flex-wrap gap-1">
                    {user.roles.filter((r) => r !== "USER").map((role) => (
                      <StatusChip key={role} tone="info">{role}</StatusChip>
                    ))}
                  </span>
                </StaffCell>
                <StaffCell className="text-xs text-muted">
                  {user.listingCount} elan · {formatDateAz(user.createdAt)}
                </StaffCell>
              </StaffRow>
            ))}
          </StaffTable>
        </div>
      )}
      {result.nextCursor !== null ? (
        <div className="mt-4">
          <PaginationLink
            href={`/admin/istifadeciler?${new URLSearchParams({ ...(phone ? { phone } : {}), cursor: result.nextCursor }).toString()}`}
            testid="users-next-page"
          >
            {ADMIN.nextPage}
          </PaginationLink>
        </div>
      ) : null}
    </div>
  );
}
