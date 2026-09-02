import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { PromotionPurchase } from "@/components/seller/promotion-purchase";
import { buttonClasses } from "@/components/ui/button";
import { ResultPanel } from "@/components/ui/result-panel";
import { isApiError } from "@/lib/api/errors";
import { vehicleTitle } from "@/lib/format";
import { SELLER, UI } from "@/lib/marketplace/labels";
import { myListings } from "@/services/my-listings";
import {
  listingPromotionState,
  promotionPackages,
} from "@/services/promotion-purchases";

export const metadata: Metadata = {
  title: `${SELLER.promotionTitle} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Owner promotion purchase page. Server authorization is
 * authoritative: the owner-scoped state lookup 404s foreign/missing
 * listings; non-promotable listings get a safe notice instead of a
 * purchase form. Prices reach the client only as server-loaded
 * package DTOs.
 */
export default async function PromotionPage({
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
    redirect(`/giris?return_to=${encodeURIComponent(`/profil/elanlar/${listingId}/tesviq`)}`);
  }
  if (auth.user.status === "BLOCKED") {
    return (
    <Container>
      <ResultPanel tone="danger" title={SELLER.blockedTitle} hint={SELLER.blockedHint} data-testid="seller-blocked" />
    </Container>
  );
  }

  let state;
  try {
    state = await listingPromotionState(auth, listingId);
  } catch (error) {
    if (isApiError(error) && error.code === "LISTING_NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  if (!state.promotable) {
    return (
    <Container>
      <ResultPanel
        tone="neutral"
        title={SELLER.promotionNotAvailable}
        hint={SELLER.promotionOnlyActiveHint}
        data-testid="promotion-unavailable"
        actions={<Link href="/profil/elanlar" className={buttonClasses("primary", "px-6")}>{UI.myListings}</Link>}
      />
    </Container>
  );
  }

  const [packages, listings] = await Promise.all([
    promotionPackages(),
    myListings(auth, "active"),
  ]);
  if (packages.length === 0) {
    // no ACTIVE packages configured (e.g. pricing not yet approved) —
    // a safe notice instead of an empty purchase form; the server
    // would reject any checkout attempt regardless
    return (
    <Container>
      <div className="py-16 text-center" data-testid="promotion-packages-unavailable">
        <h1 className="text-2xl font-bold text-navy">{SELLER.promotionPackagesUnavailable}</h1>
        <p className="mt-2 text-sm text-muted">{SELLER.promotionPackagesUnavailableHint}</p>
        <Link
          href="/profil/elanlar"
          className="mt-8 inline-flex min-h-12 items-center rounded-lg bg-primary px-6 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          {UI.myListings}
        </Link>
      </div>
    </Container>
  );
  }
  const listing = listings.find((item) => item.id === listingId);
  const title = listing !== undefined ? vehicleTitle(listing) : "Elan";

  return (
    <Container>
    <div className="mx-auto max-w-xl py-8" data-testid="promotion-page">
      <h1 className="text-2xl font-bold text-navy">{SELLER.promotionTitle}</h1>
      <p className="mt-1 text-sm text-muted">{title}</p>
      <div className="mt-6">
        <PromotionPurchase
          listingId={listingId}
          listingTitle={title}
          packages={packages}
          premiumUntil={state.premiumUntil}
          boostUntil={state.boostUntil}
        />
      </div>
    </div>
  </Container>
  );
}
