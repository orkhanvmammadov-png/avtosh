import { notFound } from "next/navigation";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { isApiError } from "@/lib/api/errors";
import { formatDateAz } from "@/lib/format";
import { ADMIN } from "@/lib/marketplace/labels";
import { isSuperAdmin, requireAdminPage } from "@/lib/admin/admin-page";
import { adminUserDetail } from "@/services/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** User detail with audited block/unblock and role controls. */
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  if (!UUID.test(userId)) notFound();
  const auth = await requireAdminPage(`/admin/istifadeciler/${userId}`);
  let user;
  try {
    user = await adminUserDetail(userId);
  } catch (error) {
    if (isApiError(error)) notFound();
    throw error;
  }
  const base = `/api/v1/admin/users/${userId}`;
  const self = auth.user.id === userId;
  const superAdmin = isSuperAdmin(auth);
  const isModerator = user.roles.includes("MODERATOR");
  const isAdminRole = user.roles.includes("ADMIN");
  const targetIsSuper = user.roles.includes("SUPER_ADMIN");

  return (
    <div className="py-6" data-testid="admin-user-detail">
      <h1 className="text-2xl font-bold tracking-tight text-navy">{user.phoneMasked}</h1>
      <dl className="mt-4 max-w-lg space-y-2 rounded-card border border-line bg-raised shadow-card p-4 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-muted">Ad</dt><dd className="font-medium text-navy">{user.displayName ?? "—"}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">{ADMIN.status}</dt>
          <dd className="font-semibold text-navy" data-testid="user-status">{user.status === "BLOCKED" ? ADMIN.blocked : ADMIN.active}</dd></div>
        {user.blockedReason !== null ? (
          <div className="flex justify-between gap-4"><dt className="text-muted">{ADMIN.blockReason}</dt>
            <dd className="whitespace-pre-line text-navy" data-testid="user-block-reason">{user.blockedReason}</dd></div>
        ) : null}
        <div className="flex justify-between gap-4"><dt className="text-muted">{ADMIN.role}</dt>
          <dd className="font-medium text-navy" data-testid="user-roles">{user.roles.join(", ")}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">{ADMIN.listingsCount}</dt><dd>{user.listingCount}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">{ADMIN.created}</dt><dd>{formatDateAz(user.createdAt)}</dd></div>
      </dl>

      {!self && (!targetIsSuper || superAdmin) ? (
        <section aria-label={ADMIN.status} className="mt-5 max-w-lg space-y-3">
          {user.status === "BLOCKED" ? (
            <ConfirmAction
              label={ADMIN.unblock}
              title={ADMIN.unblockConfirm}
              url={`${base}/unblock`}
              testid="user-unblock"
              variant="primary"
            />
          ) : (
            <ConfirmAction
              label={ADMIN.block}
              title={ADMIN.blockConfirm}
              description={ADMIN.blockHint}
              url={`${base}/block`}
              reasonField={{ name: "reason", label: ADMIN.blockReason }}
              testid="user-block"
            />
          )}
          <div className="flex flex-wrap gap-2" data-testid="role-actions">
            {isModerator ? (
              <ConfirmAction label={ADMIN.revokeModerator} title={ADMIN.roleConfirm} url={`${base}/roles`} body={{ role: "MODERATOR", action: "REVOKE" }} testid="role-revoke-moderator" />
            ) : (
              <ConfirmAction label={ADMIN.grantModerator} title={ADMIN.roleConfirm} url={`${base}/roles`} body={{ role: "MODERATOR", action: "GRANT" }} testid="role-grant-moderator" />
            )}
            {superAdmin ? (
              isAdminRole ? (
                <ConfirmAction label={ADMIN.revokeAdmin} title={ADMIN.roleConfirm} url={`${base}/roles`} body={{ role: "ADMIN", action: "REVOKE" }} testid="role-revoke-admin" />
              ) : (
                <ConfirmAction label={ADMIN.grantAdmin} title={ADMIN.roleConfirm} url={`${base}/roles`} body={{ role: "ADMIN", action: "GRANT" }} testid="role-grant-admin" />
              )
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
