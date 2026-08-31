"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPriceMinor } from "@/lib/format";
import { SELLER } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import type { RenewalStateDto } from "@/services/renewals";

/**
 * Renewal confirmation: price and duration come exclusively from the
 * server-loaded state (an OPEN intent's immutable snapshot wins over
 * the current offer); the purchase POST sends nothing but the listing
 * id and navigates to the returned hosted-payment URL.
 */
export function RenewalPurchase({ renewal }: { renewal: RenewalStateDto }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // What WILL be charged: the open intent snapshot if one exists,
  // otherwise the current server offer a new intent would freeze.
  const charge =
    renewal.openIntent !== null
      ? {
          amountMinor: renewal.openIntent.amountMinor,
          currency: renewal.openIntent.currency,
          durationDays: renewal.openIntent.durationDays ?? renewal.offer?.durationDays ?? null,
        }
      : renewal.offer !== null
        ? {
            amountMinor: renewal.offer.amountMinor,
            currency: renewal.offer.currency,
            durationDays: renewal.offer.durationDays,
          }
        : null;

  async function pay() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data } = await publicFetch<{ checkout_url: string }>(
        `/api/v1/me/listings/${renewal.listingId}/renewal/checkout`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      window.location.assign(data.checkout_url);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  if (charge === null) {
    return (
      <p className="text-sm text-muted" data-testid="renewal-unconfigured">
        {SELLER.renewalNotAvailable}
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="renewal-purchase">
      <dl className="rounded-card border border-line bg-raised p-4 text-sm shadow-card">
        <div className="flex justify-between py-1">
          <dt className="text-muted">{SELLER.promotionPrice}</dt>
          <dd className="font-semibold text-navy" data-testid="renewal-price">
            {formatPriceMinor(charge.amountMinor, charge.currency)}
          </dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-muted">{SELLER.promotionDuration}</dt>
          <dd className="font-semibold text-navy" data-testid="renewal-duration">
            {charge.durationDays !== null ? `${charge.durationDays} ${SELLER.promotionDay}` : "—"}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted" data-testid="renewal-explainer">
        {SELLER.renewalAfterPayment}{" "}
        <span className="font-semibold text-navy">{charge.durationDays ?? "—"}</span>{" "}
        {SELLER.renewalAfterPaymentTail}
      </p>
      {renewal.openIntent !== null && renewal.openIntent.status === "PENDING" ? (
        <p className="rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-xs text-warning-deep" data-testid="renewal-pending-note">
          {SELLER.renewalPendingIntent}
        </p>
      ) : null}
      <Button onClick={pay} disabled={busy} data-testid="renewal-pay" className="w-full sm:w-auto">
        {busy ? "..." : SELLER.renewalPay}
      </Button>
      {failed ? (
        <p role="alert" className="text-sm text-danger" data-testid="renewal-error">
          {SELLER.payCheckFailedHint}
        </p>
      ) : null}
    </div>
  );
}
