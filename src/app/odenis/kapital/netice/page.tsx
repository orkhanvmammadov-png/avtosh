import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { SELLER, UI } from "@/lib/marketplace/labels";
import { verifyKapitalReturn } from "@/services/payment-checkout";

export const metadata: Metadata = {
  title: `${SELLER.payCheckingTitle} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Kapital Bank return route. The ID/STATUS query parameters are
 * UNTRUSTED HINTS: STATUS is never read at all, and ID is only used
 * to locate OUR attempt record for the session user. The rendered
 * state comes exclusively from the server-to-server Get Order Details
 * verification (with exact amount/currency matching) performed by the
 * service — refreshing this page re-verifies idempotently and can
 * never double-fulfill.
 */
export default async function KapitalReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ ID?: string; STATUS?: string }>;
}) {
  const params = await searchParams;
  const providerOrderId = params.ID;
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    // session may have expired during hosted payment — return here after login
    const back = `/odenis/kapital/netice${
      providerOrderId !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(providerOrderId)
        ? `?ID=${encodeURIComponent(providerOrderId)}`
        : ""
    }`;
    redirect(`/giris?return_to=${encodeURIComponent(back)}`);
  }
  const { outcome, listingId } = await verifyKapitalReturn(auth, providerOrderId);
  const retryHref = listingId !== null ? `/elan-yerlesdir/${listingId}` : "/profil/elanlar";
  const checkAgainHref =
    providerOrderId !== undefined ? `/odenis/kapital/netice?ID=${encodeURIComponent(providerOrderId)}` : "/profil/elanlar";

  const view = (() => {
    switch (outcome.state) {
      case "SUCCESS":
        return {
          title: SELLER.paySuccessTitle,
          hint: SELLER.paySuccessHint,
          tone: "success",
          actions: [{ href: "/profil/elanlar", label: UI.myListings, testid: "payment-my-listings" }],
        };
      case "PENDING":
      case "MISMATCH":
        return {
          title: SELLER.payPendingTitle,
          hint: SELLER.payPendingHint,
          tone: "pending",
          actions: [{ href: checkAgainHref, label: SELLER.payCheckAgain, testid: "payment-check-again" }],
        };
      case "RETRYABLE":
        return {
          title: SELLER.payFailedTitle,
          hint: SELLER.payFailedHint,
          tone: "failed",
          actions: [{ href: retryHref, label: SELLER.payRetry, testid: "payment-retry" }],
        };
      case "REFUNDED":
        return {
          title: SELLER.payRefundedTitle,
          hint: SELLER.payRefundedHint,
          tone: "failed",
          actions: [{ href: "/profil/elanlar", label: UI.myListings, testid: "payment-my-listings" }],
        };
      case "CHECK_FAILED":
        return {
          title: SELLER.payCheckFailedTitle,
          hint: SELLER.payCheckFailedHint,
          tone: "pending",
          actions: [{ href: checkAgainHref, label: SELLER.payCheckAgain, testid: "payment-check-again" }],
        };
      default:
        return {
          title: SELLER.payUnknownTitle,
          hint: SELLER.payUnknownHint,
          tone: "failed",
          actions: [{ href: "/profil/elanlar", label: UI.myListings, testid: "payment-my-listings" }],
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
