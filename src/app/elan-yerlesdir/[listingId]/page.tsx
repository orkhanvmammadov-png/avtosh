import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { ListingWizard } from "@/components/seller/listing-wizard";
import { PayButton } from "@/components/seller/pay-button";
import { formatPriceMinor } from "@/lib/format";
import { isApiError } from "@/lib/api/errors";
import { SELLER, UI } from "@/lib/marketplace/labels";
import { getOwnedListingDto } from "@/services/listing-drafts";
import { isSellerEditable } from "@/services/listing-states";
import { paymentRequiredFor, sellerFeedbackFor } from "@/services/my-listings";

export const metadata: Metadata = {
  title: `${UI.postListing} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Owner wizard route. Server authorization is authoritative: the
 * owner-scoped loader 404s foreign/missing listings before anything
 * renders. Non-editable states get read-only status screens.
 */
export default async function WizardPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  if (!UUID.test(listingId)) {
    notFound();
  }
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    redirect(`/giris?return_to=${encodeURIComponent(`/elan-yerlesdir/${listingId}`)}`);
  }
  if (auth.user.status === "BLOCKED") {
    return (
      <div className="py-16 text-center" data-testid="seller-blocked">
        <h1 className="text-2xl font-bold text-navy">{SELLER.blockedTitle}</h1>
        <p className="mt-2 text-sm text-muted">{SELLER.blockedHint}</p>
      </div>
    );
  }

  let listing;
  try {
    listing = await getOwnedListingDto(auth, listingId);
  } catch (error) {
    if (isApiError(error) && error.code === "LISTING_NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  if (listing.status === "PENDING_MODERATION") {
    return (
      <div className="py-16 text-center" data-testid="wizard-status-moderation">
        <h1 className="text-2xl font-bold text-navy">{SELLER.moderationPending}</h1>
        <p className="mt-2 text-sm text-muted">{SELLER.moderationPendingHint}</p>
        <BackToMyListings />
      </div>
    );
  }

  if (listing.status === "PAYMENT_REQUIRED") {
    // The debt is the CREATED LISTING_FEE intent's immutable snapshot
    // (resolved via listing_publications.payment_id) — later changes
    // to the publication-fee setting must never alter it. Quota/
    // settings are advisory BEFORE submission only. If the intent is
    // missing (inconsistent data), no amount is shown — current
    // settings are never presented as the debt. The checkout CTA is
    // the Phase 4.12 boundary; nothing here simulates payment.
    const intent = await paymentRequiredFor(listing.id, auth.user.id, listing.status);
    return (
      <div className="py-16 text-center" data-testid="wizard-status-payment">
        <h1 className="text-2xl font-bold text-navy">{SELLER.paymentRequired}</h1>
        {intent !== null ? (
          <p className="mt-4 text-3xl font-extrabold text-primary" data-testid="payment-intent-amount">
            {formatPriceMinor(intent.amountMinor, intent.currency)}
          </p>
        ) : null}
        <p className="mt-3 text-sm text-muted">{SELLER.paymentAfterHint}</p>
        <div className="mt-6 flex justify-center">
          <PayButton listingId={listing.id} />
        </div>
        <BackToMyListings />
      </div>
    );
  }

  if (!isSellerEditable(listing.status)) {
    redirect("/profil/elanlar");
  }

  const feedback = await sellerFeedbackFor(listing.id, listing.status);
  return <ListingWizard initial={listing} feedback={feedback} />;
}

function BackToMyListings() {
  return (
    <Link
      href="/profil/elanlar"
      className="mt-8 inline-flex min-h-12 items-center rounded-lg bg-primary px-6 text-sm font-semibold text-white hover:bg-primary-hover"
    >
      {UI.myListings}
    </Link>
  );
}
