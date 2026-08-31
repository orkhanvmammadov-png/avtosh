import Link from "next/link";
import { formatDateAz, formatMileage, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { SELLER } from "@/lib/marketplace/labels";
import { REASON_LABELS, statusPresentation } from "@/lib/seller/status";
import type { OwnerCardDto } from "@/services/my-listings";

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-line/60 text-navy",
  info: "bg-primary/10 text-primary",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-danger/10 text-danger",
};

/** Owner card: status-first presentation with a context action. */
export function OwnerListingCard({ listing }: { listing: OwnerCardDto }) {
  const presentation = statusPresentation(listing.status);
  const title = vehicleTitle(listing);
  const href =
    presentation.action.kind === "wizard"
      ? `/elan-yerlesdir/${listing.id}`
      : presentation.action.kind === "public"
        ? `/elan/${listing.publicId}`
        : presentation.action.kind === "renew"
          ? `/profil/elanlar/${listing.id}/yenile`
          : null;

  return (
    <article
      className="flex gap-3 rounded-card border border-line bg-white p-3"
      data-testid="owner-listing-card"
      data-status={listing.status}
      data-listing-id={listing.id}
    >
      <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-line/40">
        {listing.primaryImageUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed owner URL
          <img src={listing.primaryImageUrl} alt={title} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${TONE_CLASSES[presentation.tone]}`}
            data-testid="owner-status"
          >
            {presentation.label}
          </span>
          <span className="text-xs text-muted">
            {listing.imageCount} {SELLER.photosCount}
          </span>
        </div>
        <h2 className="truncate text-sm font-semibold text-navy">{title}</h2>
        <p className="text-sm font-bold text-primary">{formatPriceMinor(listing.priceMinor, listing.currency)}</p>
        <p className="text-xs text-muted">
          {formatMileage(listing.mileage)}
          {listing.city !== null ? ` · ${listing.city}` : ""}
        </p>
        {listing.premiumUntil !== null || listing.boostUntil !== null ? (
          <p className="mt-1 text-xs font-medium text-navy" data-testid="owner-promotions">
            {listing.premiumUntil !== null ? (
              <span className="mr-3 text-amber-700" data-testid="owner-premium-until">
                {SELLER.premiumActive} — {formatDateAz(listing.premiumUntil)} {SELLER.promotionUntil}
              </span>
            ) : null}
            {listing.boostUntil !== null ? (
              <span className="text-primary" data-testid="owner-boost-until">
                {SELLER.boostActive} — {formatDateAz(listing.boostUntil)} {SELLER.promotionUntil}
              </span>
            ) : null}
          </p>
        ) : null}
        {listing.moderationFeedback !== null ? (
          <p className="mt-1 text-xs text-navy" data-testid="owner-feedback">
            <span className="font-semibold">{SELLER.moderationFeedback}: </span>
            {listing.moderationFeedback.reasonCode !== null
              ? (REASON_LABELS[listing.moderationFeedback.reasonCode] ?? listing.moderationFeedback.reasonCode)
              : null}
            {listing.moderationFeedback.note !== null ? ` — ${listing.moderationFeedback.note}` : ""}
          </p>
        ) : null}
      </div>
      {href !== null && presentation.action.kind !== "none" ? (
        <div className="flex shrink-0 flex-col items-stretch justify-center gap-2">
          <Link
            href={href}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line px-3 text-sm font-semibold text-primary hover:bg-surface"
            data-testid="owner-action"
          >
            {presentation.action.label}
          </Link>
          {listing.status === "ACTIVE" ? (
            <Link
              href={`/profil/elanlar/${listing.id}/tesviq`}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-hover"
              data-testid="owner-promote"
            >
              {SELLER.promote}
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
