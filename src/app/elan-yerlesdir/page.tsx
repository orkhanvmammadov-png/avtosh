import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { CreateListing } from "@/components/seller/create-listing";
import { vehicleTitle } from "@/lib/format";
import { SELLER, UI } from "@/lib/marketplace/labels";
import { statusPresentation } from "@/lib/seller/status";
import { getCategories } from "@/services/catalog";
import { myListings } from "@/services/my-listings";
import { isSellerEditable } from "@/services/listing-states";

export const metadata: Metadata = {
  title: `${UI.postListing} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Seller entry. Never auto-creates drafts: unfinished editable
 * listings are offered for continuation, and creation is an explicit
 * action. BLOCKED sellers see a safe status message instead.
 */
export default async function SellerEntryPage() {
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    redirect("/giris?return_to=%2Felan-yerlesdir");
  }
  if (auth.user.status === "BLOCKED") {
    return (
      <div className="py-16 text-center" data-testid="seller-blocked">
        <h1 className="text-2xl font-bold text-navy">{SELLER.blockedTitle}</h1>
        <p className="mt-2 text-sm text-muted">{SELLER.blockedHint}</p>
      </div>
    );
  }
  const [categories, listings] = await Promise.all([
    getCategories(),
    myListings(auth, "all"),
  ]);
  const editable = listings.filter((listing) => isSellerEditable(listing.status));

  return (
    <div className="mx-auto max-w-2xl py-8" data-testid="seller-entry">
      <h1 className="text-2xl font-bold text-navy">{UI.postListing}</h1>
      {editable.length > 0 ? (
        <section aria-label={SELLER.existingDrafts} className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-navy">{SELLER.existingDrafts}</h2>
          <ul className="space-y-2" data-testid="draft-continue-list">
            {editable.map((listing) => (
              <li key={listing.id}>
                <Link
                  href={`/elan-yerlesdir/${listing.id}`}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-2 hover:bg-surface"
                  data-testid="draft-continue"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-navy">
                    {vehicleTitle(listing)}
                    <span className="ml-2 text-xs text-muted">{statusPresentation(listing.status).label}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-primary">{SELLER.continueDraft}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="mt-6">
        <CreateListing categories={categories} />
      </div>
    </div>
  );
}
