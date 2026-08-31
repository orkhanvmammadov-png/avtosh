import { PageHeading } from "@/components/ui/page-heading";
import { PaginationLink } from "@/components/ui/pagination-link";
import { StatusChip, chipFor, PAYMENT_STATUS_CHIPS } from "@/components/ui/status-chip";
import { StaffCell, StaffRow, StaffTable } from "@/components/staff/staff-table";
import { controlClasses } from "@/components/ui/controls";
import { buttonClasses } from "@/components/ui/button";
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
      <PageHeading title={ADMIN.payments} />
      <form method="get" className="mt-4 flex flex-wrap gap-2">
        <select name="status" defaultValue={filters.status ?? ""} className={controlClasses("w-auto")} data-testid="payments-status-filter">
          <option value="">{ADMIN.status}: {ADMIN.all}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="type" defaultValue={filters.type ?? ""} className={controlClasses("w-auto")}>
          <option value="">Növ: {ADMIN.all}</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="submit" className={buttonClasses("primary")}>{ADMIN.filter}</button>
      </form>
      {result.items.length === 0 ? (
        <p className="mt-8 text-sm text-muted" data-testid="payments-empty">{ADMIN.empty}</p>
      ) : (
        <div className="mt-4">
          <StaffTable
            label={ADMIN.payments}
            testid="admin-payments"
            grid="grid-cols-[8rem_7rem_11rem_5rem_1fr]"
            minWidth="min-w-[760px]"
            columns={["Növ", "Məbləğ", ADMIN.status, "Elan", "Sahib / Tarix"]}
          >
            {result.items.map((p) => {
              const chip = chipFor(PAYMENT_STATUS_CHIPS, p.status);
              return (
                <StaffRow key={p.id} href={`/admin/odenisler/${p.id}`} grid="grid-cols-[8rem_7rem_11rem_5rem_1fr]" testid="admin-payment-row">
                  <StaffCell className="font-semibold">{p.type}</StaffCell>
                  <StaffCell>{formatPriceMinor(p.amountMinor, p.currency)}</StaffCell>
                  <StaffCell><StatusChip tone={chip.tone} code={p.status}>{chip.label}</StatusChip></StaffCell>
                  <StaffCell className="text-muted">{p.listingPublicId !== null ? `№${p.listingPublicId}` : "—"}</StaffCell>
                  <StaffCell className="text-xs text-muted">{p.ownerPhoneMasked} · {formatDateAz(p.createdAt)}</StaffCell>
                </StaffRow>
              );
            })}
          </StaffTable>
        </div>
      )}
      {result.nextCursor !== null ? (
        <div className="mt-4">
          <PaginationLink href={`/admin/odenisler?${new URLSearchParams({ ...keep, cursor: result.nextCursor }).toString()}`} testid="payments-next-page">
            {ADMIN.nextPage}
          </PaginationLink>
        </div>
      ) : null}
    </div>
  );
}
