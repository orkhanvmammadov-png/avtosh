import Link from "next/link";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { formatDateAz } from "@/lib/format";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminReports } from "@/services/admin";

export const dynamic = "force-dynamic";

const STATUSES = ["OPEN", "RESOLVED", "DISMISSED"];
const STATUS_LABELS: Record<string, string> = {
  OPEN: ADMIN.reportOpen,
  RESOLVED: ADMIN.reportResolved,
  DISMISSED: ADMIN.reportDismissed,
};

/** listing_reports workflow — the Phase 4.14 documented gap, closed read/resolve-side. */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdminPage("/admin/hesabatlar");
  const params = await searchParams;
  const status = STATUSES.includes(params.status ?? "") ? params.status : undefined;
  const result = await adminReports({ status, cursor: params.cursor });
  const keep: Record<string, string> = status !== undefined ? { status } : {};
  return (
    <div className="py-6" data-testid="admin-reports-page">
      <h1 className="text-2xl font-bold tracking-tight text-ink">{ADMIN.reports}</h1>
      <form method="get" className="mt-3 flex flex-wrap gap-2">
        <select name="status" defaultValue={status ?? ""} className="min-h-12 rounded-control border border-line bg-raised px-2 text-sm" data-testid="reports-status-filter">
          <option value="">{ADMIN.status}: {ADMIN.all}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <button type="submit" className="min-h-12 rounded-control bg-primary px-4 text-sm font-semibold text-white">{ADMIN.filter}</button>
      </form>
      {result.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted" data-testid="reports-empty">{ADMIN.empty}</p>
      ) : (
        <ul className="mt-4 space-y-2" data-testid="admin-reports">
          {result.items.map((r) => (
            <li key={r.id} className="rounded-control border border-line bg-raised px-3 py-2 text-sm" data-testid="admin-report-row" data-status={r.status}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-semibold text-ink">{r.reasonCode}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${r.status === "OPEN" ? "border border-warning-line bg-warning-soft text-warning" : "border border-line bg-sunken text-slate-strong"}`}>
                  {STATUS_LABELS[r.status] ?? r.status}
                </span>
                {r.listingPublicId !== null ? (
                  <Link href={`/admin/elanlar/${r.listingId}`} className="text-primary underline" data-testid="report-view-listing">
                    {ADMIN.viewListing} (№{r.listingPublicId})
                  </Link>
                ) : null}
                <span className="ml-auto text-xs text-muted">{formatDateAz(r.createdAt)}</span>
              </div>
              {r.note !== null ? (
                <p className="mt-1 whitespace-pre-line text-xs text-muted">{r.note}</p>
              ) : null}
              {r.status === "OPEN" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <ConfirmAction
                    label={ADMIN.resolve}
                    title={ADMIN.reportConfirm}
                    url={`/api/v1/admin/reports/${r.id}/resolve`}
                    body={{ status: "RESOLVED" }}
                    variant="primary"
                    testid={`report-resolve-${r.id}`}
                  />
                  <ConfirmAction
                    label={ADMIN.dismiss}
                    title={ADMIN.reportConfirm}
                    url={`/api/v1/admin/reports/${r.id}/resolve`}
                    body={{ status: "DISMISSED" }}
                    testid={`report-dismiss-${r.id}`}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {result.nextCursor !== null ? (
        <div className="mt-4">
          <Link href={`/admin/hesabatlar?${new URLSearchParams({ ...keep, cursor: result.nextCursor }).toString()}`} className="inline-flex min-h-12 items-center rounded-control border border-line bg-raised px-4 text-sm font-medium text-ink" data-testid="reports-next-page">
            {ADMIN.nextPage}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
