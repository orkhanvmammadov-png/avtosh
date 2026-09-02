"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDateAz, formatPriceMinor } from "@/lib/format";
import { SELLER } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import type { PromotionPackageDto } from "@/services/promotion-purchases";

/**
 * Promotion type + package selection with a confirmation summary.
 * Prices come exclusively from the server-loaded package DTOs; the
 * purchase POST sends only type + package id and navigates to the
 * returned hosted-payment URL.
 */
export function PromotionPurchase({
  listingId,
  listingTitle,
  packages,
  premiumUntil,
  boostUntil,
}: {
  listingId: string;
  listingTitle: string;
  packages: PromotionPackageDto[];
  premiumUntil: string | null;
  boostUntil: string | null;
}) {
  const [type, setType] = useState<"PREMIUM" | "BOOST">("PREMIUM");
  const [packageId, setPackageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const typed = packages.filter((pkg) => pkg.type === type);
  const selected = typed.find((pkg) => pkg.id === packageId) ?? typed[0];
  const activeUntil = type === "PREMIUM" ? premiumUntil : boostUntil;

  async function pay() {
    if (busy || selected === undefined) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data } = await publicFetch<{ checkout_url: string }>(
        `/api/v1/me/listings/${listingId}/promotions/checkout`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type, package_id: selected.id }),
        },
      );
      window.location.assign(data.checkout_url);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="promotion-purchase">
      <div role="tablist" aria-label={SELLER.promotionService} className="flex gap-1 rounded-control border border-line-strong bg-raised p-1">
        {(["PREMIUM", "BOOST"] as const).map((candidate) => (
          <button
            key={candidate}
            role="tab"
            aria-selected={type === candidate}
            className={`min-h-12 flex-1 rounded-[5px] px-4 text-sm font-semibold tracking-[0.01em] transition-colors duration-150 ${
              type === candidate ? "bg-primary text-white" : "text-ink hover:bg-primary-tint hover:text-primary"
            }`}
            onClick={() => {
              setType(candidate);
              setPackageId(null);
            }}
            data-testid={`promo-type-${candidate}`}
          >
            {candidate === "PREMIUM" ? "Premium" : "Boost"}
          </button>
        ))}
      </div>

      <p className="text-sm leading-relaxed text-slate-strong">
        {type === "PREMIUM" ? SELLER.premiumDescription : SELLER.boostDescription}
      </p>

      {activeUntil !== null ? (
        <p className="rounded-control bg-info-soft px-4 py-3 text-sm leading-relaxed text-info" data-testid="promo-active-note">
          {type === "PREMIUM" ? SELLER.premiumActive : SELLER.boostActive} —{" "}
          {formatDateAz(activeUntil)} {SELLER.promotionUntil}. {SELLER.promotionQueuedHint}
        </p>
      ) : null}

      {typed.length === 0 ? (
        <p className="rounded-control bg-sunken px-4 py-3 text-sm text-slate-strong" data-testid="promo-type-unavailable">
          {SELLER.promotionPackagesUnavailable}
        </p>
      ) : null}

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-slate-strong">{SELLER.promotionDuration}</legend>
        <div className="space-y-2">
          {typed.map((pkg) => (
            <label
              key={pkg.id}
              className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-card border px-4 py-2.5 transition-colors duration-150 ${
                selected?.id === pkg.id ? "border-primary bg-primary-tint" : "border-line-strong bg-raised hover:border-primary"
              }`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="promotion-package"
                  className="accent-primary"
                  checked={selected?.id === pkg.id}
                  onChange={() => setPackageId(pkg.id)}
                  data-testid={`promo-package-${pkg.durationDays}`}
                />
                <span className="text-sm font-semibold text-ink">
                  {pkg.durationDays} {SELLER.promotionDay}
                </span>
              </span>
              <span className="font-condensed text-[17px] font-bold text-ink">
                {formatPriceMinor(pkg.priceMinor, pkg.currency)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {selected !== undefined ? (
        <section
          aria-label={SELLER.promotionConfirmTitle}
          className="rounded-card border border-line bg-raised p-4"
          data-testid="promo-confirmation"
        >
          <h2 className="text-sm font-bold text-ink">{SELLER.promotionConfirmTitle}</h2>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-strong">Elan</dt>
              <dd className="font-medium text-ink">{listingTitle}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-strong">{SELLER.promotionService}</dt>
              <dd className="font-medium text-ink">{type === "PREMIUM" ? "Premium" : "Boost"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-strong">{SELLER.promotionDuration}</dt>
              <dd className="font-medium text-ink">
                {selected.durationDays} {SELLER.promotionDay}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-strong">{SELLER.promotionPrice}</dt>
              <dd className="font-condensed text-[19px] font-bold text-ink" data-testid="promo-price">
                {formatPriceMinor(selected.priceMinor, selected.currency)}
              </dd>
            </div>
          </dl>
          <Button
            className="mt-4 w-full"
            disabled={busy}
            onClick={() => void pay()}
            data-testid="promo-pay"
          >
            {busy ? SELLER.payInitiating : SELLER.payNow}
          </Button>
          {failed ? (
            <p role="alert" className="mt-3 text-sm text-danger" data-testid="promo-init-failed">
              {SELLER.payInitFailed}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
