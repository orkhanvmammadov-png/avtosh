"use client";

import Link from "next/link";
import { formatAzPhoneForDisplay } from "@/components/auth/phone-format";
import { buttonClasses } from "@/components/ui/button";
import { formatDateAz, formatMileage, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { SELLER, UI } from "@/lib/marketplace/labels";
import type { OwnerListingDto } from "@/lib/seller/owner-api";
import { OPTION_GROUPS, useWizardCatalog } from "@/components/seller/use-wizard-catalog";

/**
 * O.12 "Redaktəyə bax" — the PENDING_MODERATION revision rendered
 * read-only (03-axin-edit-mode.md): same proposed content, ZERO
 * mutation surfaces (no inputs, no autosave, no image controls, no
 * submit, no cancel). State bar shows the real submitted_at only —
 * never a moderator ETA.
 */
export function PendingEditView({
  listing,
  submittedAt,
}: {
  listing: OwnerListingDto;
  submittedAt: string | null;
}) {
  const catalog = useWizardCatalog(listing.category, listing.brandId);
  const title = vehicleTitle({
    brand: catalog.nameOf(listing.brandId),
    model: catalog.nameOf(listing.modelId),
    year: listing.year,
  });
  const specBits = [
    listing.engineCc === null ? null : `${listing.engineCc} sm³`,
    ...OPTION_GROUPS.map((g) => catalog.nameOf(listing[g.dtoKey])),
  ].filter((v): v is string => v !== null);
  const chips = [
    listing.creditAvailable ? SELLER.credit : null,
    listing.barterAvailable ? SELLER.barter : null,
    listing.noAccident === true ? SELLER.noAccident : null,
    listing.notRepainted === true ? SELLER.notRepainted : null,
  ].filter((v): v is Exclude<typeof v, null> => v !== null);
  const featureNames = listing.featureIds
    .map((id) => catalog.nameOf(id))
    .filter((v): v is string => v !== null);

  return (
    <div data-testid="pending-edit-view">
      <div className="bg-navy text-white">
        <div className="mx-auto flex h-12 max-w-full items-center justify-between gap-3 px-4 md:max-w-[540px] md:px-6 desk:max-w-[640px] desk:px-0 xl:max-w-[680px]">
          <p className="min-w-0 truncate text-[13px] font-bold">{SELLER.editHeader}</p>
          <Link href="/profil/elanlar" className="shrink-0 text-[12px] font-medium text-white/80 hover:text-white">
            {UI.myListings}
          </Link>
        </div>
      </div>

      {/* state bar — text-based, date only when the API supplies it */}
      <div className="bg-warning-soft" data-testid="pending-edit-bar">
        <p className="mx-auto max-w-full px-4 py-2 text-[12px] font-semibold text-warning md:max-w-[540px] md:px-6 desk:max-w-[640px] desk:px-0 xl:max-w-[680px]">
          {SELLER.pendingBar}
          {submittedAt !== null ? (
            <span className="font-medium">
              {" "}· {SELLER.pendingSubmittedWord}: {formatDateAz(submittedAt)}
            </span>
          ) : null}
        </p>
      </div>

      <div className="mx-auto max-w-full space-y-3.5 px-4 py-5 md:max-w-[540px] md:px-6 desk:max-w-[640px] desk:px-0 xl:max-w-[680px]">
        <div className="rounded-card border border-line bg-raised p-3.5">
          <p className="text-[13.5px] font-bold text-ink" data-testid="pending-title">{title}</p>
          <p className="mt-1 font-condensed text-[19px] font-bold leading-none text-ink" data-testid="pending-price">
            {formatPriceMinor(listing.priceMinor, listing.currency)}
          </p>
          <p className="mt-1.5 text-xs text-muted">
            {[
              listing.mileage === null ? null : formatMileage(listing.mileage),
              catalog.nameOf(listing.cityId),
            ]
              .filter((v): v is string => v !== null)
              .join(" · ")}
          </p>
          {specBits.length > 0 ? (
            <p className="mt-2.5 border-t border-line pt-2.5 text-xs leading-relaxed text-slate-strong">
              {specBits.join(" · ")}
            </p>
          ) : null}
          {chips.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex h-6 items-center rounded-[5px] border border-[#147A4E]/40 bg-[#E7F2EC] px-2 text-[11px] font-medium text-[#147A4E]"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {listing.images.length > 0 ? (
          <div className="rounded-card border border-line bg-raised p-3.5">
            <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              {SELLER.photos}
            </h2>
            <div className="mt-2 grid grid-cols-3 gap-[7px] desk:grid-cols-4" data-testid="pending-images">
              {listing.images.map((image, index) => (
                <div
                  key={image.id}
                  className={`relative aspect-[4/3] overflow-hidden rounded-lg border bg-sunken ${
                    image.isPrimary ? "border-2 border-[#147A4E]" : "border-line"
                  }`}
                >
                  {image.url !== null ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed owner URL
                    <img src={image.url} alt={`${SELLER.photos} ${index + 1}`} className="h-full w-full object-cover" />
                  ) : null}
                  {image.isPrimary ? (
                    <span className="absolute left-1.5 top-1.5 rounded-[5px] bg-[#147A4E] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.04em] text-white">
                      {SELLER.primaryPhoto}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {featureNames.length > 0 || (listing.description !== null && listing.description !== "") ? (
          <div className="rounded-card border border-line bg-raised p-3.5">
            <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              {SELLER.sectionExtras}
            </h2>
            {featureNames.length > 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-slate-strong" data-testid="pending-features">
                {featureNames.join(" · ")}
              </p>
            ) : null}
            {listing.description !== null && listing.description !== "" ? (
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink" data-testid="pending-description">
                {listing.description}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-card border border-line bg-raised p-3.5" data-testid="pending-contact">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
            {SELLER.reviewContactTitle}
          </h2>
          <p className="mt-1 text-[12.5px] font-semibold text-ink">{listing.sellerName ?? "—"}</p>
          <p className="text-[12.5px] text-slate-strong">
            {listing.contactPhone === null ? "—" : formatAzPhoneForDisplay(listing.contactPhone)}
          </p>
        </div>

        <div className="pt-2">
          <Link href="/profil/elanlar" className={buttonClasses("secondary", "px-6")} data-testid="pending-back">
            {UI.myListings}
          </Link>
        </div>
      </div>
    </div>
  );
}
