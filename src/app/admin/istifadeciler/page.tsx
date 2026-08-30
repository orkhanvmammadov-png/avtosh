import Link from "next/link";
import { formatDateAz } from "@/lib/format";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminUsers } from "@/services/admin";

export const dynamic = "force-dynamic";

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
      <h1 className="text-xl font-bold text-navy">{ADMIN.users}</h1>
      <form method="get" className="mt-3 flex gap-2" role="search">
        <input
          type="search"
          name="phone"
          defaultValue={phone ?? ""}
          placeholder={ADMIN.phoneSearch}
          className="min-h-12 w-64 max-w-full rounded-lg border border-line bg-white px-3 text-sm text-navy"
          data-testid="user-phone-search"
        />
        <button type="submit" className="min-h-12 rounded-lg bg-primary px-4 text-sm font-semibold text-white">
          {ADMIN.search}
        </button>
      </form>
      {result.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted" data-testid="users-empty">{ADMIN.empty}</p>
      ) : (
        <ul className="mt-4 space-y-1.5" data-testid="admin-users">
          {result.items.map((user) => (
            <li key={user.id}>
              <Link
                href={`/admin/istifadeciler/${user.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-white px-3 py-2 text-sm hover:shadow-sm"
                data-testid="admin-user-row"
              >
                <span className="font-semibold text-navy">{user.phoneMasked}</span>
                <span className="text-muted">{user.displayName ?? "—"}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                    user.status === "BLOCKED" ? "bg-danger/10 text-danger" : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {user.status === "BLOCKED" ? ADMIN.blocked : ADMIN.active}
                </span>
                {user.roles.filter((r) => r !== "USER").map((role) => (
                  <span key={role} className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                    {role}
                  </span>
                ))}
                <span className="ml-auto text-xs text-muted">
                  {ADMIN.listingsCount}: {user.listingCount} · {formatDateAz(user.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {result.nextCursor !== null ? (
        <div className="mt-4">
          <Link
            href={`/admin/istifadeciler?${new URLSearchParams({ ...(phone ? { phone } : {}), cursor: result.nextCursor }).toString()}`}
            className="inline-flex min-h-12 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium text-navy"
            data-testid="users-next-page"
          >
            {ADMIN.nextPage}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
