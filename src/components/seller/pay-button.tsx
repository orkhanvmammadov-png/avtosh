"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SELLER } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";

/**
 * "Ödəniş et" — asks the server to create/reuse the provider checkout
 * and navigates to the returned hosted payment page. The browser
 * never sees amounts, provider credentials, or order passwords as
 * separate fields — only the opaque checkout URL.
 */
export function PayButton({ listingId }: { listingId: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function pay() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data } = await publicFetch<{ checkout_url: string }>(
        `/api/v1/me/listings/${listingId}/payment/checkout`,
        { method: "POST" },
      );
      window.location.assign(data.checkout_url);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div>
      <Button
        onClick={() => void pay()}
        disabled={busy}
        className="min-w-48"
        data-testid="pay-button"
      >
        {busy ? SELLER.payInitiating : SELLER.payNow}
      </Button>
      {failed ? (
        <p role="alert" className="mt-3 text-sm text-danger" data-testid="pay-init-failed">
          {SELLER.payInitFailed}
        </p>
      ) : null}
    </div>
  );
}
