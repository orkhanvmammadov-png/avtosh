import { PageHeading } from "@/components/ui/page-heading";
import { PaginationLink } from "@/components/ui/pagination-link";
import { StatusChip, chipFor, LISTING_STATUS_CHIPS } from "@/components/ui/status-chip";
import { StaffCell, StaffRow, StaffTable } from "@/components/staff/staff-table";
import { controlClasses } from "@/components/ui/controls";
import { buttonClasses } from "@/components/ui/button";
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
      <PageHeading title={ADMIN.listings} />
      <form method="get" className="mt-4 flex flex-wrap gap-2">
        <select name="status" defaultValue={filters.status ?? ""} className={controlClasses("w-auto")} data-testid="listings-status-filter">
          <option value="">{ADMIN.status}: {ADMIN.all}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="category" defaultValue={filters.category ?? ""} className={controlClasses("w-auto")}>
          <option value="">Kateqoriya: {ADMIN.all}</option>
          <option value="CAR">CAR</option>
          <option value="MOTORCYCLE">MOTORCYCLE</option>
        </select>
        <input name="public_id" defaultValue={filters.publicId ?? ""} placeholder="№" inputMode="numeric" className={controlClasses("w-24")} />
        <input name="owner_phone" defaultValue={filters.ownerPhone ?? ""} placeholder={ADMIN.phoneSearch} className={controlClasses("w-44")} />
        <button type="submit" className={buttonClasses("primary")}>{ADMIN.filter}</button>
      </form>
      {result.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted" data-testid="listings-empty">{ADMIN.empty}</p>
      ) : (
        <div className="mt-4">
          <StaffTable
            label={ADMIN.listings}
            testid="admin-listings"
            grid="grid-cols-[5rem_1fr_11rem_8rem_12rem]"
            minWidth="min-w-[760px]"
            columns={["№", "Elan", ADMIN.status, ADMIN.price, "Sahib / Tarix"]}
          >
            {result.items.map((l) => {
              const chip = chipFor(LISTING_STATUS_CHIPS, l.status);
              return (
                <StaffRow key={l.id} href={`/admin/elanlar/${l.id}`} grid="grid-cols-[5rem_1fr_11rem_8rem_12rem]" testid="admin-listing-row">
                  <StaffCell className="font-semibold">№{l.publicId}</StaffCell>
                  <StaffCell>{[l.brand, l.model].filter(Boolean).join(" ") || "—"}</StaffCell>
                  <StaffCell><StatusChip tone={chip.tone} code={l.status}>{chip.label}</StatusChip></StaffCell>
                  <StaffCell className="text-muted">{formatPriceMinor(l.priceMinor, "AZN")}</StaffCell>
                  <StaffCell className="text-xs text-muted">{l.ownerPhoneMasked} · {formatDateAz(l.createdAt)}</StaffCell>
                </StaffRow>
              );
            })}
          </StaffTable>
        </div>
      )}
      {result.nextCursor !== null ? (
        <div className="mt-4">
          <PaginationLink href={`/admin/elanlar?${new URLSearchParams({ ...keep, cursor: result.nextCursor }).toString()}`} testid="listings-next-page">
            {ADMIN.nextPage}
          </PaginationLink>
        </div>
      ) : null}
    </div>
  );
}
