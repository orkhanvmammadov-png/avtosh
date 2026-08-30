import Link from "next/link";
import { formatDateAz, formatPriceMinor } from "@/lib/format";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminPayments } from "@/services/admin";

export const dynamic = "force-dynamic";

const STATUSES = ["CREATED", "PENDING", "SUCCESS", "FAILED", "CANCELLED", "REFUNDED"];
const TYPES = ["LISTING_FEE", "RENEWAL", "BOOST", "PREMIUM"];

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdminPage("/admin/odenisler");
  const params = await searchParams;
  const filters = {
    status: STATUSES.includes(params.status ?? "") ? params.status : undefined,
    type: TYPES.includes(params.type ?? "") ? params.type : undefined,
    cursor: params.cursor,
  };
  const result = await adminPayments(filters);
  const keep = Object.fromEntries(
    Object.entries({ status: filters.status, type: filters.type }).filter(([, v]) => v !== undefined) as [string, string][],
  );
  return (
    <div className="py-6" data-testid="admin-payments-page">
      <h1 className="text-xl font-bold text-navy">{ADMIN.payments}</h1>
      <form method="get" className="mt-3 flex flex-wrap gap-2">
        <select name="status" defaultValue={filters.status ?? ""} className="min-h-12 rounded-lg border border-line bg-white px-2 text-sm" data-testid="payments-status-filter">
          <option value="">{ADMIN.status}: {ADMIN.all}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="type" defaultValue={filters.type ?? ""} className="min-h-12 rounded-lg border border-line bg-white px-2 text-sm">
          <option value="">Növ: {ADMIN.all}</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="submit" className="min-h-12 rounded-lg bg-primary px-4 text-sm font-semibold text-white">{ADMIN.filter}</button>
      </form>
      {result.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted" data-testid="payments-empty">{ADMIN.empty}</p>
      ) : (
        <ul className="mt-4 space-y-1.5" data-testid="admin-payments">
          {result.items.map((p) => (
            <li key={p.id}>
              <Link href={`/admin/odenisler/${p.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-white px-3 py-2 text-sm hover:shadow-sm" data-testid="admin-payment-row">
                <span className="font-semibold text-navy">{p.type}</span>
                <span className="text-navy">{formatPriceMinor(p.amountMinor, p.currency)}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${p.status === "SUCCESS" ? "bg-emerald-100 text-emerald-800" : p.status === "PENDING" ? "bg-amber-100 text-amber-800" : "bg-line/60 text-navy"}`}>
                  {p.status}
                </span>
                {p.listingPublicId !== null ? <span className="text-muted">№{p.listingPublicId}</span> : null}
                <span className="ml-auto text-xs text-muted">{p.ownerPhoneMasked} · {formatDateAz(p.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {result.nextCursor !== null ? (
        <div className="mt-4">
          <Link href={`/admin/odenisler?${new URLSearchParams({ ...keep, cursor: result.nextCursor }).toString()}`} className="inline-flex min-h-12 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium text-navy" data-testid="payments-next-page">
            {ADMIN.nextPage}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
