import { PageHeading } from "@/components/ui/page-heading";
import { PaginationLink } from "@/components/ui/pagination-link";
import { controlClasses } from "@/components/ui/controls";
import { buttonClasses } from "@/components/ui/button";
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
      <PageHeading title={ADMIN.audit} />
      <form method="get" className="mt-4 flex flex-wrap gap-2">
        <input
          name="action"
          defaultValue={action ?? ""}
          placeholder={ADMIN.action}
          className={controlClasses("w-52")}
          data-testid="audit-action-filter"
        />
        <input
          name="entity_id"
          defaultValue={entityId ?? ""}
          placeholder={ADMIN.entity}
          className={controlClasses("w-72")}
          data-testid="audit-entity-filter"
        />
        <select name="actor_type" defaultValue={actorType ?? ""} className={controlClasses("w-auto")}>
          <option value="">{ADMIN.actor}: {ADMIN.all}</option>
          {ACTOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="submit" className={buttonClasses("primary")}>{ADMIN.filter}</button>
      </form>
      {result.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted" data-testid="audit-empty">{ADMIN.empty}</p>
      ) : (
        <ul className="mt-4 space-y-1.5" data-testid="audit-rows">
          {result.items.map((row) => (
            <li key={row.id} className="rounded-control border border-line bg-raised px-3 py-2 text-sm shadow-card" data-testid="audit-row" data-action={row.action}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-strong">{row.action}</span>
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
          <PaginationLink href={`/admin/audit?${new URLSearchParams({ ...keep, cursor: result.nextCursor }).toString()}`} testid="audit-next-page">
            {ADMIN.nextPage}
          </PaginationLink>
        </div>
      ) : null}
    </div>
  );
}
