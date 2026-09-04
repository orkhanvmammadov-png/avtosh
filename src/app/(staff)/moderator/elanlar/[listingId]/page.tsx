import { notFound } from "next/navigation";
import { ModerationActions } from "@/components/moderator/moderation-actions";
import { chipFor, LISTING_STATUS_CHIPS } from "@/components/ui/status-chip";
import { isApiError } from "@/lib/api/errors";
import { formatDateAz, formatMileage, formatPriceMinor, vehicleTitle } from "@/lib/format";
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

  const specs: [string, string | null][] = [
    ["Kateqoriya", detail.category === "MOTORCYCLE" ? "Motosiklet" : "Avtomobil"],
    ["Yürüş", detail.mileage === null ? null : formatMileage(detail.mileage)],
    ["Mühərrik", detail.engineCc === null ? null : `${detail.engineCc} sm³`],
    ["Yanacaq", detail.fuelType],
    ["Sürətlər qutusu", detail.transmission],
    ["Ban növü", detail.bodyType],
    ["Ötürücü", detail.driveType],
    ["Moto növü", detail.motorcycleType],
    ["Rəng", detail.color],
    ["Şəhər", detail.cityName],
    ["Vuruğu yoxdur", detail.noAccident === true ? "Qeyd edilib" : "Qeyd edilməyib"],
    ["Rənglənməyib", detail.notRepainted === true ? "Qeyd edilib" : "Qeyd edilməyib"],
    ["Kredit", detail.creditAvailable ? "Var" : "Yoxdur"],
    ["Barter", detail.barterAvailable ? "Var" : "Yoxdur"],
    [STAFF.contactField, detail.contactPhone],
    [STAFF.seller, `${detail.seller.displayName ?? "—"} · ${detail.seller.phoneMasked}`],
    [STAFF.submittedAt, detail.submittedAt === null ? null : formatDateTime(detail.submittedAt)],
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

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <section aria-label={STAFF.images} className="rounded-staff border border-line bg-raised p-3">
            <h2 className="mb-2 text-sm font-bold text-ink">{STAFF.images}</h2>
            {detail.images.length === 0 ? (
              <p className="text-sm text-muted">{STAFF.noImage}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 md:grid-cols-3" data-testid="moderation-gallery">
                {detail.images.map((image, index) => (
                  <li key={image.id} className="relative overflow-hidden rounded-staff bg-sunken">
                    {image.url !== null ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      <img
                        src={image.url}
                        alt={`${title} — ${index + 1}`}
                        className="aspect-vehicle w-full object-cover text-transparent"
                        loading={index < 3 ? "eager" : "lazy"}
                      />
                    ) : (
                      <div
                        className="flex aspect-vehicle w-full items-center justify-center text-xs text-slate-strong"
                        data-testid="gallery-image-fallback"
                      >
                        {STAFF.noImage}
                      </div>
                    )}
                    {image.isPrimary ? (
                      <span className="absolute left-1.5 top-1.5 rounded-[3px] bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-white">
                        {STAFF.primaryTag}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label={STAFF.specs} className="rounded-staff border border-line bg-raised p-4">
            <h2 className="text-sm font-bold text-ink">{STAFF.specs}</h2>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2" data-testid="review-specs">
              {specs
                .filter(([, value]) => value !== null)
                .map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-line py-1.5 text-sm">
                    <dt className="text-slate-strong">{label}</dt>
                    <dd className="text-right font-medium text-ink">{value}</dd>
                  </div>
                ))}
            </dl>
          </section>

          {detail.description !== null ? (
            <section aria-label={STAFF.descriptionTitle} className="rounded-staff border border-line bg-raised p-4">
              <h2 className="text-sm font-bold text-ink">{STAFF.descriptionTitle}</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink" data-testid="review-description">
                {detail.description}
              </p>
            </section>
          ) : null}

          <section aria-label={STAFF.history} className="rounded-staff border border-line bg-raised p-4">
            <h2 className="text-sm font-bold text-ink">{STAFF.history}</h2>
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
        </div>

        <div className="lg:sticky lg:top-16 lg:self-start">
          <ModerationActions
            listingId={detail.id}
            status={detail.status}
            revision={detail.revision}
            claimMine={claimMine}
            claimOther={claimOther}
            claimExpiresAt={claimMine ? detail.claim!.expiresAt : null}
          />
        </div>
      </div>
    </div>
  );
}
