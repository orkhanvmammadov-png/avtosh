import Link from "next/link";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { ADMIN_CATALOG_ENTITIES, adminCatalog } from "@/services/admin";

export const dynamic = "force-dynamic";

const ENTITY_LABELS: Record<string, string> = {
  brands: "Markalar",
  models: "Modellər",
  cities: "Şəhərlər",
  features: "Təchizatlar",
  options: "Seçimlər",
};

/** Catalog administration — activation toggles only, rows are never deleted. */
export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdminPage("/admin/kataloq");
  const params = await searchParams;
  const entity = (ADMIN_CATALOG_ENTITIES as readonly string[]).includes(params.entity ?? "")
    ? (params.entity as string)
    : "brands";
  const rows = await adminCatalog(entity);
  return (
    <div className="py-6" data-testid="admin-catalog-page">
      <h1 className="text-2xl font-bold tracking-tight text-navy">{ADMIN.catalog}</h1>
      <nav aria-label={ADMIN.catalog} className="mt-3 flex flex-wrap gap-1.5">
        {ADMIN_CATALOG_ENTITIES.map((e) => (
          <Link
            key={e}
            href={`/admin/kataloq?entity=${e}`}
            className={`min-h-12 rounded-lg border px-3 py-3 text-sm font-medium ${e === entity ? "border-primary bg-primary text-white" : "border-line bg-raised text-navy"}`}
            data-testid={`catalog-tab-${e}`}
            aria-current={e === entity ? "page" : undefined}
          >
            {ENTITY_LABELS[e]}
          </Link>
        ))}
      </nav>
      <ul className="mt-4 space-y-1.5" data-testid="catalog-rows">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-control border border-line bg-raised px-3 py-2 text-sm"
            data-testid="catalog-row"
            data-active={row.is_active ? "true" : "false"}
          >
            <span className="font-medium text-navy">{row.name}</span>
            {row.extra !== null ? <span className="text-xs text-muted">{row.extra}</span> : null}
            <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${row.is_active ? "border border-success-line bg-success-soft text-success-deep" : "border border-line bg-sunken text-slate-strong"}`}>
              {row.is_active ? ADMIN.active : "Deaktiv"}
            </span>
            <div className="ml-auto">
              <ConfirmAction
                label={row.is_active ? ADMIN.deactivate : ADMIN.activate}
                title={row.is_active ? ADMIN.deactivateConfirm : ADMIN.activateConfirm}
                url={`/api/v1/admin/catalog/${entity}`}
                body={{ id: row.id, is_active: !row.is_active }}
                testid={`catalog-toggle-${row.id}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
