import Link from "next/link";
import { formatDateAz } from "@/lib/format";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminAudit } from "@/services/admin";

export const dynamic = "force-dynamic";

const ACTOR_TYPES = ["ADMIN", "MODERATOR", "SYSTEM", "USER"];

/** Read-only append-only audit explorer — no mutation of audit data exists anywhere. */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdminPage("/admin/audit");
  const params = await searchParams;
  const action = (params.action ?? "").replace(/[^A-Z_]/g, "") || undefined;
  const entityId = (params.entity_id ?? "").trim() || undefined;
  const actorType = ACTOR_TYPES.includes(params.actor_type ?? "") ? params.actor_type : undefined;
  const result = await adminAudit({ action, entityId, actorType, cursor: params.cursor });
  const keep = Object.fromEntries(
    Object.entries({ action, entity_id: entityId, actor_type: actorType }).filter(
      ([, v]) => v !== undefined,
    ) as [string, string][],
  );
  return (
    <div className="py-6" data-testid="admin-audit-page">
      <h1 className="text-xl font-bold text-navy">{ADMIN.audit}</h1>
      <form method="get" className="mt-3 flex flex-wrap gap-2">
        <input
          name="action"
          defaultValue={action ?? ""}
          placeholder={ADMIN.action}
          className="min-h-12 w-52 rounded-lg border border-line bg-white px-2 text-sm"
          data-testid="audit-action-filter"
        />
        <input
          name="entity_id"
          defaultValue={entityId ?? ""}
          placeholder={ADMIN.entity}
          className="min-h-12 w-72 rounded-lg border border-line bg-white px-2 text-sm"
          data-testid="audit-entity-filter"
        />
        <select name="actor_type" defaultValue={actorType ?? ""} className="min-h-12 rounded-lg border border-line bg-white px-2 text-sm">
          <option value="">{ADMIN.actor}: {ADMIN.all}</option>
          {ACTOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="submit" className="min-h-12 rounded-lg bg-primary px-4 text-sm font-semibold text-white">{ADMIN.filter}</button>
      </form>
      {result.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted" data-testid="audit-empty">{ADMIN.empty}</p>
      ) : (
        <ul className="mt-4 space-y-1.5" data-testid="audit-rows">
          {result.items.map((row) => (
            <li key={row.id} className="rounded-lg border border-line bg-white px-3 py-2 text-sm" data-testid="audit-row" data-action={row.action}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-semibold text-navy">{row.action}</span>
                <span className="text-xs text-muted">{row.actorType}{row.actorPhoneMasked !== null ? ` · ${row.actorPhoneMasked}` : ""}</span>
                <span className="text-xs text-muted">{row.entityType} · {row.entityId}</span>
                <span className="ml-auto text-xs text-muted">{formatDateAz(row.createdAt)}</span>
              </div>
              {row.afterData !== null ? (
                <p className="mt-1 break-all font-mono text-xs text-muted" data-testid="audit-data">
                  {JSON.stringify(row.afterData)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {result.nextCursor !== null ? (
        <div className="mt-4">
          <Link href={`/admin/audit?${new URLSearchParams({ ...keep, cursor: result.nextCursor }).toString()}`} className="inline-flex min-h-12 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium text-navy" data-testid="audit-next-page">
            {ADMIN.nextPage}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
