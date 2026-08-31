import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { isApiError } from "@/lib/api/errors";
import { formatDateAz, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { ADMIN, STAFF } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import type { ModerationDetailView } from "@/lib/moderator/types";
import { adminListingCommerce } from "@/services/admin";
import { getModerationDetail } from "@/services/moderation";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admin listing detail: moderation-safe data + commerce/lifecycle context. */
export default async function AdminListingDetailPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  if (!UUID.test(listingId)) notFound();
  await requireAdminPage(`/admin/elanlar/${listingId}`);
  let detail: ModerationDetailView;
  try {
    detail = (await getModerationDetail(listingId)) as unknown as ModerationDetailView;
  } catch (error) {
    if (isApiError(error)) notFound();
    throw error;
  }
  const commerce = await adminListingCommerce(listingId);
  const title = vehicleTitle({ brand: detail.brand?.name ?? null, model: detail.model?.name ?? null, year: detail.year });

  return (
    <div className="py-6" data-testid="admin-listing-detail" data-status={detail.status}>
      <h1 className="text-xl font-bold text-navy">{title}</h1>
      <p className="mt-1 text-sm text-muted">
        №{detail.publicId} · <span className="font-semibold text-navy" data-testid="listing-status">{detail.status}</span>
        {" · "}{formatPriceMinor(detail.priceMinor, detail.currency)} · {STAFF.seller}: {detail.seller.phoneMasked}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/moderator/elanlar/${listingId}`} className="inline-flex min-h-12 items-center rounded-lg border border-line bg-white px-4 text-sm font-medium text-navy" data-testid="open-in-moderation">
          {ADMIN.moderatorPortal}
        </Link>
        {detail.status === "SUSPENDED" ? (
          <ConfirmAction
            label={ADMIN.unsuspend}
            title={ADMIN.unsuspendConfirm}
            description={ADMIN.unsuspendHint}
            url={`/api/v1/admin/listings/${listingId}/unsuspend`}
            variant="primary"
            testid="listing-unsuspend"
          />
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section aria-label="Yerləşdirmələr" className="rounded-card border border-line bg-white p-4 text-sm">
          <h2 className="font-semibold text-navy">Yerləşdirmə və müddətlər</h2>
          <ul className="mt-2 space-y-1" data-testid="listing-publications">
            {commerce.publications.map((p) => (
              <li key={p.number} className="text-muted">
                Nəşr #{p.number} — {p.billingType} — {formatDateAz(p.createdAt)}
              </li>
            ))}
            {commerce.periods.map((p) => (
              <li key={p.number} className="text-muted">
                Dövr #{p.number} ({p.source}): {formatDateAz(p.startsAt)} → {formatDateAz(p.endsAt)}
              </li>
            ))}
            {commerce.publications.length === 0 && commerce.periods.length === 0 ? <li className="text-muted">—</li> : null}
          </ul>
        </section>
        <section aria-label="Təşviqlər" className="rounded-card border border-line bg-white p-4 text-sm">
          <h2 className="font-semibold text-navy">Təşviqlər</h2>
          <ul className="mt-2 space-y-1" data-testid="listing-promotions">
            {commerce.promotions.length === 0 ? <li className="text-muted">—</li> : null}
            {commerce.promotions.map((p, i) => (
              <li key={i} className="text-muted">
                {p.type} ({p.status}) {p.durationDays} gün: {formatDateAz(p.startsAt)} → {formatDateAz(p.endsAt)}
              </li>
            ))}
          </ul>
        </section>
        <section aria-label={ADMIN.payments} className="rounded-card border border-line bg-white p-4 text-sm lg:col-span-2">
          <h2 className="font-semibold text-navy">{ADMIN.payments}</h2>
          <ul className="mt-2 space-y-1" data-testid="listing-payments">
            {commerce.payments.length === 0 ? <li className="text-muted">—</li> : null}
            {commerce.payments.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/odenisler/${p.id}`} className="text-primary hover:underline">
                  {p.type} — {formatPriceMinor(p.amountMinor, p.currency)} — {p.status} — {formatDateAz(p.createdAt)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label={STAFF.history} className="rounded-card border border-line bg-white p-4 text-sm lg:col-span-2">
          <h2 className="font-semibold text-navy">{STAFF.history}</h2>
          <ul className="mt-2 space-y-1" data-testid="listing-reviews">
            {detail.reviews.length === 0 ? <li className="text-muted">{STAFF.historyEmpty}</li> : null}
            {detail.reviews.map((r) => (
              <li key={r.id} className="text-muted">
                {r.decision}{r.note !== null ? ` — ${r.note}` : ""} — {formatDateAz(r.reviewedAt)}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
