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
      <div role="tablist" aria-label={SELLER.promotionService} className="flex gap-1 rounded-lg border border-line bg-white p-1">
        {(["PREMIUM", "BOOST"] as const).map((candidate) => (
          <button
            key={candidate}
            role="tab"
            aria-selected={type === candidate}
            className={`min-h-12 flex-1 rounded-md px-4 text-sm font-semibold ${
              type === candidate ? "bg-primary text-white" : "text-navy hover:bg-surface"
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

      <p className="text-sm text-muted">
        {type === "PREMIUM" ? SELLER.premiumDescription : SELLER.boostDescription}
      </p>

      {activeUntil !== null ? (
        <p className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-navy" data-testid="promo-active-note">
          {type === "PREMIUM" ? SELLER.premiumActive : SELLER.boostActive} —{" "}
          {formatDateAz(activeUntil)} {SELLER.promotionUntil}. {SELLER.promotionQueuedHint}
        </p>
      ) : null}

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-navy">{SELLER.promotionDuration}</legend>
        <div className="space-y-2">
          {typed.map((pkg) => (
            <label
              key={pkg.id}
              className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 ${
                selected?.id === pkg.id ? "border-primary bg-primary/5" : "border-line bg-white"
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
                <span className="text-sm font-medium text-navy">
                  {pkg.durationDays} {SELLER.promotionDay}
                </span>
              </span>
              <span className="text-sm font-bold text-primary">
                {formatPriceMinor(pkg.priceMinor, pkg.currency)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {selected !== undefined ? (
        <section
          aria-label={SELLER.promotionConfirmTitle}
          className="rounded-card border border-line bg-white p-4"
          data-testid="promo-confirmation"
        >
          <h2 className="text-sm font-semibold text-navy">{SELLER.promotionConfirmTitle}</h2>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Elan</dt>
              <dd className="font-medium text-navy">{listingTitle}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{SELLER.promotionService}</dt>
              <dd className="font-medium text-navy">{type === "PREMIUM" ? "Premium" : "Boost"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{SELLER.promotionDuration}</dt>
              <dd className="font-medium text-navy">
                {selected.durationDays} {SELLER.promotionDay}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{SELLER.promotionPrice}</dt>
              <dd className="font-bold text-primary" data-testid="promo-price">
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
