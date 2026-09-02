import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { RenewalPurchase } from "@/components/seller/renewal-purchase";
import { buttonClasses } from "@/components/ui/button";
import { ResultPanel } from "@/components/ui/result-panel";
import { isApiError } from "@/lib/api/errors";
import { formatDateAz } from "@/lib/format";
import { SELLER, UI } from "@/lib/marketplace/labels";
import { renewalState } from "@/services/renewals";

export const metadata: Metadata = {
  title: `${SELLER.renewalTitle} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Owner renewal page. Server authorization is authoritative: the
 * owner-scoped lookup 404s foreign/missing listings; non-EXPIRED
 * listings get a safe notice instead of a purchase form. Fee and
 * duration reach the client only as server-loaded state.
 */
export default async function RenewalPage({
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
    redirect(`/giris?return_to=${encodeURIComponent(`/profil/elanlar/${listingId}/yenile`)}`);
  }
  if (auth.user.status === "BLOCKED") {
    return (
    <Container>
      <ResultPanel tone="danger" title={SELLER.blockedTitle} hint={SELLER.blockedHint} data-testid="seller-blocked" />
    </Container>
  );
  }

  let renewal;
  try {
    renewal = await renewalState(auth, listingId);
  } catch (error) {
    if (isApiError(error) && error.code === "LISTING_NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  if (!renewal.eligible) {
    return (
    <Container>
      <ResultPanel
        tone="neutral"
        title={SELLER.renewalNotAvailable}
        hint={SELLER.renewalOnlyExpiredHint}
        data-testid="renewal-unavailable"
        actions={<Link href="/profil/elanlar" className={buttonClasses("primary", "px-6")}>{UI.myListings}</Link>}
      />
    </Container>
  );
  }

  return (
    <Container>
    <div className="mx-auto max-w-xl py-8" data-testid="renewal-page">
      <h1 className="text-xl font-bold tracking-[-0.01em] text-ink md:text-2xl">{SELLER.renewalTitle}</h1>
      <p className="mt-1 text-sm text-muted" data-testid="renewal-listing">
        {renewal.title} — №{renewal.publicId}
      </p>
      {renewal.currentExpiresAt !== null ? (
        <p className="mt-1 text-xs text-muted" data-testid="renewal-expired-at">
          {SELLER.renewalExpiredAt}: {formatDateAz(renewal.currentExpiresAt)}
        </p>
      ) : null}
      <p className="mt-4 text-sm text-muted">{SELLER.renewalHint}</p>
      <div className="mt-6">
        <RenewalPurchase renewal={renewal} />
      </div>
    </div>
  </Container>
  );
}
