import Link from "next/link";
import { formatDateAz, formatMileage, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { SELLER } from "@/lib/marketplace/labels";
import { REASON_LABELS, statusPresentation, type StatusPresentation } from "@/lib/seller/status";
import { EditEntryButton } from "@/components/seller/edit-entry-button";
import { ListingLifecycleActions } from "@/components/seller/listing-lifecycle-actions";
import type { OwnerCardDto } from "@/services/my-listings";

// Approved status chip recipe: borderless tint + dot (components.md).
const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-sunken text-slate-strong",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

/** O.12 secondary edit-lifecycle chip (09-copy.md; the primary status
    pill stays authoritative — never demoted by a pending edit). */
function editChip(listing: OwnerCardDto): { label: string; className: string } | null {
  const m = listing.management;
  if (m.editStatus === null || m.primary === "PRE_PUBLICATION") return null;
  if (m.editStatus === "EDIT_DRAFT") {
    return m.primary === "DEACTIVATED"
      ? { label: SELLER.chipDeactivatedDraft, className: "bg-sunken text-slate-strong" }
      : { label: SELLER.chipEditDraft, className: "bg-success-soft text-success" };
  }
  if (m.editStatus === "PENDING_MODERATION") {
    return { label: SELLER.chipEditPending, className: "bg-sunken text-slate-strong" };
  }
  if (m.editStatus === "CORRECTION_REQUIRED") {
    return { label: SELLER.chipEditCorrection, className: "bg-warning-soft text-warning" };
  }
  if (m.editStatus === "APPROVED" && m.primary === "EXPIRED") {
    return { label: SELLER.chipEditApproved, className: "bg-success-soft text-success" };
  }
  return null;
}

/** Owner card: status-first presentation with a context action. */
export function OwnerListingCard({ listing }: { listing: OwnerCardDto }) {
  const m = listing.management;
  // O.12 sealed precedence drives the PRIMARY pill; effective expiry
  // (deadline passed, job lagging) presents as EXPIRED, and Deaktiv
  // gets its own presentation with no public link.
  const presentation: StatusPresentation =
    m.primary === "DEACTIVATED"
      ? { label: SELLER.statusDeactivated, tone: "neutral", action: { kind: "none" } }
      : m.effectiveExpired
        ? statusPresentation("EXPIRED")
        : statusPresentation(listing.status);
  const chip = editChip(listing);
  const title = vehicleTitle(listing);
  // O.12: expired cards derive their renewal affordance from the
  // server capability (sealed order edit → moderation → renewal hides
  // the CTA while an edit is open); other statuses keep the existing
  // presentation-driven action.
  const expired = m.primary === "EXPIRED";
  const href = expired
    ? m.renewal === "RENEW" || m.renewal === "RENEW_ACTIVATE"
      ? `/profil/elanlar/${listing.id}/yenile`
      : null
    : presentation.action.kind === "wizard"
      ? `/elan-yerlesdir/${listing.id}`
      : presentation.action.kind === "public"
        ? `/elan/${listing.publicId}`
        : presentation.action.kind === "renew"
          ? `/profil/elanlar/${listing.id}/yenile`
          : null;
  const actionLabel =
    expired && m.renewal === "RENEW_ACTIVATE"
      ? SELLER.actionRenewActivate
      : presentation.action.kind === "none"
        ? null
        : presentation.action.label;

  // O.12 edit affordance (ONE per card): EDIT starts via the explicit
  // create-or-get button; CONTINUE/FIX resume, VIEW opens read-only.
  const editLabel =
    m.editAction === "CONTINUE"
      ? SELLER.actionContinueEdit
      : m.editAction === "VIEW"
        ? SELLER.actionViewEdit
        : m.editAction === "FIX"
          ? SELLER.actionFix
          : null;
  // one green primary per card: resuming/fixing an edit is the primary
  // next step wherever no promote CTA exists (deactivated/expired)
  const editIsPrimary =
    m.primary !== "ACTIVE" && (m.editAction === "CONTINUE" || m.editAction === "FIX");

  return (
    <article
      className="flex gap-3 rounded-card border border-line bg-raised p-3 transition-colors duration-150 hover:border-line-strong"
      data-testid="owner-listing-card"
      data-status={listing.status}
      data-listing-id={listing.id}
    >
      <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-sunken">
        {listing.primaryImageUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed owner URL
          <img src={listing.primaryImageUrl} alt={title} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[presentation.tone]}`}
            data-testid="owner-status"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            {presentation.label}
          </span>
          {chip !== null ? (
            <span
              className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[10.5px] font-semibold ${chip.className}`}
              data-testid="owner-edit-chip"
            >
              {chip.label}
            </span>
          ) : null}
          <span className="text-[11.5px] tracking-[0.01em] text-muted">
            {listing.imageCount} {SELLER.photosCount}
          </span>
        </div>
        <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
        <p className="font-condensed text-[17px] font-bold leading-tight text-ink">{formatPriceMinor(listing.priceMinor, listing.currency)}</p>
        <p className="text-xs text-muted">
          {formatMileage(listing.mileage)}
          {listing.city !== null ? ` · ${listing.city}` : ""}
        </p>
        {listing.premiumUntil !== null || listing.boostUntil !== null ? (
          <p className="mt-1 text-xs font-medium text-ink" data-testid="owner-promotions">
            {listing.premiumUntil !== null ? (
              <span className="mr-3 text-premium-ink" data-testid="owner-premium-until">
                {SELLER.premiumActive} — {formatDateAz(listing.premiumUntil)} {SELLER.promotionUntil}
              </span>
            ) : null}
            {listing.boostUntil !== null ? (
              <span className="text-boost" data-testid="owner-boost-until">
                {SELLER.boostActive} — {formatDateAz(listing.boostUntil)} {SELLER.promotionUntil}
              </span>
            ) : null}
          </p>
        ) : null}
        {m.primary === "DEACTIVATED" ? (
          <p className="text-xs text-muted" data-testid="owner-deactivated-meta">
            {SELLER.deactivatedMeta}
          </p>
        ) : null}
        {m.awaitingActivation ? (
          <p className="mt-1 text-xs font-semibold text-slate-strong" data-testid="owner-awaiting-activation">
            {SELLER.afterModeration}
          </p>
        ) : null}
        {expired && m.editStatus === "PENDING_MODERATION" ? (
          <p className="mt-1 text-xs text-muted" data-testid="owner-renewal-hint">
            {SELLER.expiredPendingHint}
          </p>
        ) : null}
        {listing.moderationFeedback !== null ? (
          <p className="mt-1 rounded-control bg-danger-soft px-2.5 py-1.5 text-xs leading-relaxed text-danger" data-testid="owner-feedback">
            <span className="font-semibold">{SELLER.moderationFeedback}: </span>
            {listing.moderationFeedback.reasonCode !== null
              ? (REASON_LABELS[listing.moderationFeedback.reasonCode] ?? listing.moderationFeedback.reasonCode)
              : null}
            {listing.moderationFeedback.note !== null ? ` — ${listing.moderationFeedback.note}` : ""}
          </p>
        ) : null}
      </div>
      {href !== null || m.editAction !== null || m.canDeactivate || m.canReactivate ? (
        <div className="flex shrink-0 flex-col items-stretch justify-center gap-2">
          {href !== null && presentation.action.kind !== "none" ? (
          <Link
            href={href}
            className="inline-flex min-h-12 items-center justify-center rounded-control border border-primary px-3 text-sm font-semibold tracking-[0.01em] text-primary transition-colors duration-150 hover:bg-primary-tint active:bg-primary-tint-pressed"
            data-testid="owner-action"
          >
            {actionLabel}
          </Link>
          ) : null}
          {m.editAction === "EDIT" ? (
            <EditEntryButton listingId={listing.id} primary={false} />
          ) : editLabel !== null ? (
            <Link
              href={`/profil/elanlar/${listing.id}/redakte`}
              className={
                editIsPrimary
                  ? "inline-flex min-h-12 items-center justify-center rounded-control bg-primary px-3 text-sm font-semibold tracking-[0.01em] text-white transition-colors duration-150 hover:bg-primary-hover active:bg-primary-pressed"
                  : "inline-flex min-h-12 items-center justify-center rounded-control border border-primary px-3 text-sm font-semibold tracking-[0.01em] text-primary transition-colors duration-150 hover:bg-primary-tint active:bg-primary-tint-pressed"
              }
              data-testid="owner-edit-link"
              data-edit-action={m.editAction ?? undefined}
            >
              {editLabel}
            </Link>
          ) : null}
          {listing.status === "ACTIVE" && m.primary === "ACTIVE" ? (
            (() => {
              // O.9 post-ACTIVE handoff: a creation-time intent is
              // pending only while no same-type SUCCESS payment exists
              // AND its intended package is still active; then the CTA
              // continues the seller's own choice. Satisfaction is per
              // TYPE, so Premium purchased leaves a Boost intent live.
              const pendingIntent =
                (listing.premiumIntent !== null &&
                  listing.premiumIntent.packageActive &&
                  !listing.premiumSatisfied) ||
                (listing.boostIntent !== null &&
                  listing.boostIntent.packageActive &&
                  !listing.boostSatisfied);
              return (
                <Link
                  href={`/profil/elanlar/${listing.id}/tesviq`}
                  className="inline-flex min-h-12 items-center justify-center rounded-control bg-primary px-3 text-sm font-semibold tracking-[0.01em] text-white transition-colors duration-150 hover:bg-primary-hover active:bg-primary-pressed"
                  data-testid="owner-promote"
                  data-intent={pendingIntent ? "pending" : "none"}
                >
                  {pendingIntent ? SELLER.promoContinueIntent : SELLER.promote}
                </Link>
              );
            })()
          ) : null}
          {m.canDeactivate || m.canReactivate ? (
            <ListingLifecycleActions listingId={listing.id} revision={listing.revision} management={m} />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
