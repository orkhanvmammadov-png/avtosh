import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { AccountNav } from "@/components/seller/account-nav";
import { LogoutButton } from "@/components/shared/logout-button";
import { Notice } from "@/components/ui/notice";
import { SectionCard } from "@/components/ui/section-card";
import { SELLER, UI } from "@/lib/marketplace/labels";
import { maskPhone } from "@/auth/phone";
import { formatPriceMinor } from "@/lib/format";
import { getListingQuota } from "@/services/listing-submission";
import type { ListingQuotaDto } from "@/services/listing-submission";

export const metadata: Metadata = {
  title: `${UI.account} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/** Minimal buyer profile shell (Phase 4.10). Seller dashboard is a later phase. */
export default async function ProfilePage() {
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    redirect("/giris?return_to=%2Fprofil");
  }
  const { user } = auth;
  // Read-only reuse of the accepted quota source; the card is purely
  // informational and hidden if publication settings are unavailable.
  let quota: ListingQuotaDto | null = null;
  try {
    quota = await getListingQuota(auth);
  } catch {
    quota = null;
  }
  const linkRow =
    "rounded-card border border-line bg-raised px-4 py-3 text-sm font-medium text-ink transition-colors duration-150 hover:border-line-strong hover:bg-row-hover";
  return (
    <Container>
      <div className="py-6" data-testid="profile-page">
        <AccountNav active="profile" />
        <h1 className="mt-6 text-xl font-bold tracking-[-0.01em] text-ink md:text-2xl">{UI.account}</h1>
        {user.status === "BLOCKED" ? (
          <div className="mt-4 max-w-md">
            <Notice tone="danger" role="status" data-testid="blocked-notice">
              {UI.accountBlocked}
            </Notice>
          </div>
        ) : null}
        <div className="mt-6 max-w-md space-y-4">
          <SectionCard>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-strong">{UI.phoneLabel}</dt>
                <dd className="font-mono font-medium text-ink" data-testid="profile-phone">{maskPhone(user.phone_e164)}</dd>
              </div>
              {user.display_name ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-strong">Ad</dt>
                  <dd className="font-medium text-ink">{user.display_name}</dd>
                </div>
              ) : null}
              {quota !== null ? (
                <div className="flex justify-between gap-4 border-t border-line pt-3">
                  <dt className="text-slate-strong">{SELLER.quotaFreeRemaining.replace(":", "")}</dt>
                  <dd className="font-medium text-ink" data-testid="profile-quota">
                    {quota.freeRemaining > 0
                      ? `${quota.freeRemaining} / ${quota.freeLimit}`
                      : `0 / ${quota.freeLimit} — növbəti elan ${formatPriceMinor(quota.listingFeeMinor, quota.currency)}`}
                  </dd>
                </div>
              ) : null}
            </dl>
          </SectionCard>
          <nav aria-label={UI.account} className="flex flex-col gap-2">
            <Link href="/profil/elanlar" className={linkRow} data-testid="profile-my-listings-link">
              {UI.myListings}
            </Link>
            <Link href="/profil/secilmisler" className={linkRow} data-testid="profile-favorites-link">
              {UI.favorites}
            </Link>
            <Link href="/elan-yerlesdir" className={linkRow}>
              {UI.postListing}
            </Link>
            <LogoutButton className="inline-flex justify-start border border-line bg-raised px-4" />
          </nav>
        </div>
      </div>
    </Container>
  );
}
