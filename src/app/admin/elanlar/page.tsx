import Link from "next/link";
import { formatDateAz, formatPriceMinor } from "@/lib/format";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminListings } from "@/services/admin";

export const dynamic = "force-dynamic";

const STATUSES = ["DRAFT","PAYMENT_REQUIRED","PAYMENT_COMPLETED","PENDING_MODERATION","CORRECTION_REQUIRED","REJECTED","ACTIVE","SUSPENDED","SOLD","EXPIRED","DELETED"];

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdminPage("/admin/elanlar");
  const params = await searchParams;
  const filters = {
    status: STATUSES.includes(params.status ?? "") ? params.status : undefined,
    category: ["CAR", "MOTORCYCLE"].includes(params.category ?? "") ? params.category : undefined,
    publicId: /^[0-9]{1,12}$/.test(params.public_id ?? "") ? params.public_id : undefined,
    ownerPhone: /^[+0-9]{2,16}$/.test(params.owner_phone ?? "") ? params.owner_phone : undefined,
    cursor: params.cursor,
  };
  const result = await adminListings(filters);
  const keep = Object.fromEntries(
    Object.entries({ status: filters.status, category: filters.category, public_id: filters.publicId, owner_phone: filters.ownerPhone })
      .filter(([, v]) => v !== undefined) as [string, string][],
  );
  return (
    <div className="py-6" data-testid="admin-listings-page">
      <h1 className="text-xl font-bold text-navy">{ADMIN.listings}</h1>
      <form method="get" className="mt-3 flex flex-wrap gap-2">
        <select name="status" defaultValue={filters.status ?? ""} className="min-h-12 rounded-lg border border-line bg-white px-2 text-sm" data-testid="listings-status-filter">
          <option value="">{ADMIN.status}: {ADMIN.all}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="category" defaultValue={filters.category ?? ""} className="min-h-12 rounded-lg border border-line bg-white px-2 text-sm">
          <option value="">Kateqoriya: {ADMIN.all}</option>
          <option value="CAR">CAR</option>
          <option value="MOTORCYCLE">MOTORCYCLE</option>
        </select>
        <input name="public_id" defaultValue={filters.publicId ?? ""} placeholder="№" inputMode="numeric" className="min-h-12 w-24 rounded-lg border border-line bg-white px-2 text-sm" />
        <input name="owner_phone" defaultValue={filters.ownerPhone ?? ""} placeholder={ADMIN.phoneSearch} className="min-h-12 w-44 rounded-lg border border-line bg-white px-2 text-sm" />
        <button type="submit" className="min-h-12 rounded-lg bg-primary px-4 text-sm font-semibold text-white">{ADMIN.filter}</button>
      </form>
      {result.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted" data-testid="listings-empty">{ADMIN.empty}</p>
      ) : (
        <ul className="mt-4 space-y-1.5" data-testid="admin-listings">
          {result.items.map((l) => (
            <li key={l.id}>
              <Link href={`/admin/elanlar/${l.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-white px-3 py-2 text-sm hover:shadow-sm" data-testid="admin-listing-row">
                <span className="font-semibold text-navy">№{l.publicId}</span>
                <span className="text-navy">{[l.brand, l.model].filter(Boolean).join(" ") || "—"}</span>
                <span className="rounded bg-line/60 px-1.5 py-0.5 text-xs font-semibold text-navy">{l.status}</span>
                <span className="text-muted">{formatPriceMinor(l.priceMinor, "AZN")}</span>
                <span className="ml-auto text-xs text-muted">{l.ownerPhoneMasked} · {formatDateAz(l.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {result.nextCursor !== null ? (
        <div className="mt-4">
          <Link href={`/admin/elanlar?${new URLSearchParams({ ...keep, cursor: result.nextCursor }).toString()}`} className="inline-flex min-h-12 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium text-navy" data-testid="listings-next-page">
            {ADMIN.nextPage}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
