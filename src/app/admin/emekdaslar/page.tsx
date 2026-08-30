import Link from "next/link";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminStaff } from "@/services/admin";

export const dynamic = "force-dynamic";

/** Staff overview; role changes happen on the user detail page. */
export default async function AdminStaffPage() {
  await requireAdminPage("/admin/emekdaslar");
  const staff = await adminStaff();
  return (
    <div className="py-6" data-testid="admin-staff-page">
      <h1 className="text-xl font-bold text-navy">{ADMIN.staff}</h1>
      <ul className="mt-4 space-y-1.5" data-testid="admin-staff">
        {staff.map((user) => (
          <li key={user.id}>
            <Link
              href={`/admin/istifadeciler/${user.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-white px-3 py-2 text-sm hover:shadow-sm"
              data-testid="staff-row"
            >
              <span className="font-semibold text-navy">{user.phoneMasked}</span>
              <span className="text-muted">{user.displayName ?? "—"}</span>
              {user.roles.filter((r) => r !== "USER").map((role) => (
                <span key={role} className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                  {role}
                </span>
              ))}
              {user.status === "BLOCKED" ? (
                <span className="rounded bg-danger/10 px-1.5 py-0.5 text-xs font-semibold text-danger">{ADMIN.blocked}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
