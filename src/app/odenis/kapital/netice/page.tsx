import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { formatDateAz } from "@/lib/format";
import { SELLER, UI } from "@/lib/marketplace/labels";
import { handleKapitalCallback } from "@/services/payment-checkout";

export const metadata: Metadata = {
  title: `${SELLER.payCheckingTitle} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Kapital Bank return route. The ID/STATUS query parameters are
 * UNTRUSTED HINTS: STATUS is never read at all, and ID only locates
 * OUR attempt record. Payment verification + fulfillment run
 * SESSION-INDEPENDENTLY (an expired AVTOSH session can never block a
 * legitimate FullyPaid fulfillment); the session only decides how
 * much this page may personalize. Anonymous/foreign/unknown callers
 * all receive one indistinguishable generic view — the callback is
 * never an enumeration oracle, and unknown ids trigger no provider
 * call. Refreshing re-verifies idempotently and can never
 * double-fulfill.
 */
export default async function KapitalReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ ID?: string; STATUS?: string }>;
}) {
  const params = await searchParams;
  const providerOrderId = params.ID;
  const auth = await getCurrentAuthFromCookies();
  const result = await handleKapitalCallback(auth, providerOrderId);

  if (result.view === "GENERIC") {
    // One safe answer for everyone who is not the verified owner:
    // no seller identity, listing data, amounts, or order existence.
    const loginBack =
      providerOrderId !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(providerOrderId)
        ? `/giris?return_to=${encodeURIComponent(`/odenis/kapital/netice?ID=${providerOrderId}`)}`
        : "/giris";
    return (
      <div className="mx-auto max-w-xl py-16 text-center" data-testid="payment-result" data-state="GENERIC">
        <h1 className="text-2xl font-bold text-navy">{SELLER.payGenericTitle}</h1>
        <p className="mt-3 text-sm text-muted">{SELLER.payGenericHint}</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href={loginBack}
            data-testid="payment-login"
            className="inline-flex min-h-12 items-center rounded-lg bg-primary px-6 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            {UI.login}
          </Link>
        </div>
      </div>
    );
  }

  const { outcome, listingId, purpose, promotionEndsAt, renewalExpiresAt } = result;
  const retryHref = listingId !== null ? `/elan-yerlesdir/${listingId}` : "/profil/elanlar";
  const checkAgainHref =
    providerOrderId !== undefined
      ? `/odenis/kapital/netice?ID=${encodeURIComponent(providerOrderId)}`
      : "/profil/elanlar";

  const view = (() => {
    switch (outcome.state) {
      case "SUCCESS": {
        if (purpose === "RENEWAL") {
          const until =
            renewalExpiresAt !== null
              ? ` ${SELLER.renewalNewExpiry}: ${formatDateAz(renewalExpiresAt)}.`
              : "";
          return {
            title: SELLER.renewalSuccessTitle,
            hint: `${SELLER.renewalSuccessHint}${until}`,
            actions: [{ href: "/profil/elanlar", label: UI.myListings, testid: "payment-my-listings" }],
          };
        }
        if (purpose === "PREMIUM" || purpose === "BOOST") {
          const until =
            promotionEndsAt !== null
              ? ` ${formatDateAz(promotionEndsAt)} ${SELLER.promotionUntil}.`
              : "";
          return {
            title: purpose === "PREMIUM" ? SELLER.premiumActivated : SELLER.boostActivated,
            hint: `${SELLER.promotionActivatedHint}${until}`,
            actions: [{ href: "/profil/elanlar", label: UI.myListings, testid: "payment-my-listings" }],
          };
        }
        return {
          title: SELLER.paySuccessTitle,
          hint: SELLER.paySuccessHint,
          actions: [{ href: "/profil/elanlar", label: UI.myListings, testid: "payment-my-listings" }],
        };
      }
      case "PENDING":
      case "MISMATCH":
        return {
          title: SELLER.payPendingTitle,
          hint: SELLER.payPendingHint,
          actions: [{ href: checkAgainHref, label: SELLER.payCheckAgain, testid: "payment-check-again" }],
        };
      case "RETRYABLE":
        return {
          title: SELLER.payFailedTitle,
          hint: SELLER.payFailedHint,
          actions: [{ href: retryHref, label: SELLER.payRetry, testid: "payment-retry" }],
        };
      case "REFUNDED":
        return {
          title: SELLER.payRefundedTitle,
          hint: SELLER.payRefundedHint,
          actions: [{ href: "/profil/elanlar", label: UI.myListings, testid: "payment-my-listings" }],
        };
      default:
        return {
          title: SELLER.payCheckFailedTitle,
          hint: SELLER.payCheckFailedHint,
          actions: [{ href: checkAgainHref, label: SELLER.payCheckAgain, testid: "payment-check-again" }],
        };
    }
  })();

  return (
    <div className="mx-auto max-w-xl py-16 text-center" data-testid="payment-result" data-state={outcome.state}>
      <h1 className="text-2xl font-bold text-navy">{view.title}</h1>
      <p className="mt-3 text-sm text-muted">{view.hint}</p>
      <div className="mt-8 flex justify-center gap-3">
        {view.actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            data-testid={action.testid}
            className="inline-flex min-h-12 items-center rounded-lg bg-primary px-6 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
