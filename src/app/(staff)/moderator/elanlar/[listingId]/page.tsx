import { notFound } from "next/navigation";
import { EditReviewDiff } from "@/components/moderator/edit-review-diff";
import {
  FullReviewSections,
  type FullReviewContent,
} from "@/components/moderator/full-review-sections";
import { ModerationWorkbench } from "@/components/moderator/adjustment-workbench";
import { chipFor, LISTING_STATUS_CHIPS } from "@/components/ui/status-chip";
import { isApiError } from "@/lib/api/errors";
import { formatDateAz, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { STAFF } from "@/lib/marketplace/labels";
import { requireStaffPage } from "@/lib/moderator/staff-page";
import type { ModerationDetailView } from "@/lib/moderator/types";
import { REASON_LABELS } from "@/lib/seller/status";
import { getModerationDetail } from "@/services/moderation";

export const dynamic = "force-dynamic";

// Approved staff chip recipe: borderless tint + dot, r4.
const CHIP_TONE_CLASSES: Record<string, string> = {
  neutral: "bg-sunken text-slate-strong",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  premium: "bg-premium-soft text-premium-ink",
  boost: "bg-boost-soft text-boost",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DECISION_LABELS: Record<string, string> = {
  APPROVED: STAFF.decisionApproved,
  REJECTED: STAFF.decisionRejected,
  CORRECTION_REQUESTED: STAFF.decisionCorrection,
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat("az-Latn-AZ", {
    timeZone: "Asia/Baku",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${formatDateAz(date)} ${time}`;
}

/**
 * Moderation review screen. Authenticated moderation DTO only — a
 * pending listing is NEVER fetched through the public API. All text
 * (seller description, notes) renders as escaped plain text.
 */
export default async function ModerationReviewPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  if (!UUID.test(listingId)) {
    notFound();
  }
  const auth = await requireStaffPage(`/moderator/elanlar/${listingId}`);

  let detail: ModerationDetailView;
  try {
    detail = (await getModerationDetail(listingId)) as unknown as ModerationDetailView;
  } catch (error) {
    if (isApiError(error) && error.code === "LISTING_NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const title = vehicleTitle({
    brand: detail.brand?.name ?? null,
    model: detail.model?.name ?? null,
    year: detail.year,
  });
  const claimMine = detail.claim !== null && detail.claim.moderatorId === auth.user.id;
  const claimOther = detail.claim !== null && !claimMine;

  // O.13 Stage A: ONE normalized content view feeds the structured
  // full-review sections — for NEW it is the submitted listing content,
  // for LISTING_EDIT it doubles as the "Mövcud elan" (current approved)
  // layer under the proposed content.
  const listingContent: FullReviewContent = {
    category: detail.category,
    brandName: detail.brand?.name ?? null,
    modelName: detail.model?.name ?? null,
    modelVariantName: detail.modelVariant?.name ?? null,
    year: detail.year,
    priceMinor: detail.priceMinor,
    currency: detail.currency,
    mileage: detail.mileage,
    engineCc: detail.engineCc,
    fuelType: detail.fuelType,
    transmission: detail.transmission,
    bodyType: detail.bodyType,
    driveType: detail.driveType,
    motorcycleType: detail.motorcycleType,
    color: detail.color,
    cityName: detail.cityName,
    creditAvailable: detail.creditAvailable,
    barterAvailable: detail.barterAvailable,
    noAccident: detail.noAccident,
    notRepainted: detail.notRepainted,
    description: detail.description,
    sellerName: detail.sellerName,
    contactPhone: detail.contactPhone,
    featureGroups: detail.featureGroups,
    images: detail.images,
  };
  // Account identity + submission time stay in Satıcı / Əlaqə —
  // subject-level context, never proposed content.
  const contactExtras = (submittedAt: string | null): [string, string | null][] => [
    [STAFF.seller, `${detail.seller.displayName ?? "—"} · ${detail.seller.phoneMasked}`],
    [STAFF.submittedAt, submittedAt === null ? null : formatDateTime(submittedAt)],
  ];

  const chipSpec = chipFor(LISTING_STATUS_CHIPS, detail.status);
  const statusChip = {
    label: chipSpec.label,
    toneClasses: CHIP_TONE_CLASSES[chipSpec.tone],
  };

  return (
    <div className="py-6" data-testid="moderation-review" data-status={detail.status}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.01em] text-ink md:text-2xl">{title}</h1>
          <p className="mt-1 text-sm text-muted">
            {STAFF.review} · №{detail.publicId} ·{" "}
            <span className={`inline-flex items-center gap-1.5 rounded-staff px-2 py-0.5 text-xs font-semibold ${statusChip.toneClasses}`}>
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
              {statusChip.label}
              <span className="font-mono text-[10px] font-normal" data-testid="review-status">{detail.status}</span>
            </span>
            {" · "}
            {formatPriceMinor(detail.priceMinor, detail.currency)}
          </p>
        </div>
      </header>

      <ModerationWorkbench
        listingId={detail.id}
        status={detail.status}
        revision={detail.revision}
        claimMine={claimMine}
        claimOther={claimOther}
        claimExpiresAt={claimMine ? detail.claim!.expiresAt : null}
        editRevisionNo={detail.editReview?.editRevisionNo ?? null}
        currentUserId={auth.user.id}
        subject={detail.adjustmentContext?.subject ?? null}
        baseContent={detail.adjustmentContext?.baseContent ?? null}
        baseImages={(detail.editReview !== null
          ? detail.editReview.sellerSubmitted.images
          : detail.images
        ).map((image) => ({
          sourceId: image.id,
          url: image.url,
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary,
        }))}
        imageMin={detail.adjustmentContext?.imageMin ?? 3}
        adjustment={detail.adjustment}
      >
        <>
          {detail.editReview !== null ? (
            <>
              {/* O.12: changed-first comparison stays FIRST … */}
              <EditReviewDiff review={detail.editReview} />
              {/* … then O.13 Stage A: the COMPLETE proposed listing —
                  the moderator never infers unchanged values from the
                  old listing … */}
              <FullReviewSections
                content={detail.editReview.sellerSubmitted}
                testId="edit-full-data"
                layerNote={STAFF.layerProposed}
                contactExtras={contactExtras(detail.editReview.submittedAt)}
                galleryAlt={title}
              />
              {/* … with the full current approved layer collapsed below */}
              <details
                className="rounded-staff border border-line bg-raised p-4"
                data-testid="edit-current-data"
              >
                <summary className="cursor-pointer text-sm font-bold text-ink">
                  {STAFF.layerCurrent}
                </summary>
                <div className="mt-3">
                  <FullReviewSections
                    content={listingContent}
                    testId="edit-current-sections"
                    heading={null}
                    galleryAlt={title}
                  />
                </div>
              </details>
            </>
          ) : (
            <FullReviewSections
              content={listingContent}
              testId="review-specs"
              contactExtras={contactExtras(detail.submittedAt)}
              galleryAlt={title}
            />
          )}

          <section aria-label={STAFF.history} className="rounded-staff border border-line bg-raised p-4">
            <h2 className="text-sm font-bold text-ink">{STAFF.history}</h2>
            {/* O.13 Stage B: append-only adjustment lineage (actor +
                timestamp) — survives discard, proves multi-moderator
                authorship without a version-control UI */}
            {detail.adjustmentEvents.length > 0 ? (
              <ul className="mt-3 space-y-2 border-l-2 border-line pl-4" data-testid="adjustment-history">
                {detail.adjustmentEvents.map((event, index) => (
                  <li key={index} className="relative text-sm">
                    <span aria-hidden="true" className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-raised bg-info" />
                    <p className="font-semibold text-ink">
                      {event.action === "MODERATION_ADJUSTMENT_DISCARDED"
                        ? STAFF.historyAdjDiscarded
                        : STAFF.historyAdjSaved}
                      {event.actorName !== null ? ` — ${event.actorName}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">{formatDateTime(event.at)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {detail.reviews.length === 0 ? (
              <p className="mt-2 text-sm text-muted" data-testid="history-empty">{STAFF.historyEmpty}</p>
            ) : (
              <ul className="mt-3 space-y-4 border-l-2 border-line pl-4" data-testid="moderation-history">
                {detail.reviews.map((review) => (
                  <li key={review.id} className="relative text-sm">
                    <span aria-hidden="true" className="absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-raised bg-line-strong" />
                    <p className="font-semibold text-ink">
                      {DECISION_LABELS[review.decision] ?? review.decision}
                      {review.reasonCode !== null
                        ? ` — ${REASON_LABELS[review.reasonCode] ?? review.reasonCode}`
                        : ""}
                    </p>
                    {review.note !== null ? (
                      <p className="mt-1 whitespace-pre-line text-slate-strong" data-testid="history-note">{review.note}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted">{formatDateTime(review.reviewedAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      </ModerationWorkbench>
    </div>
  );
}
