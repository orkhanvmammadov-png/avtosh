import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { OwnerListingCard } from "@/components/seller/owner-listing-card";
import { SELLER, UI } from "@/lib/marketplace/labels";
import {
  MY_LISTINGS_FILTERS,
  myListings,
  type MyListingsFilter,
} from "@/services/my-listings";

export const metadata: Metadata = {
  title: `${UI.myListings} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const FILTER_LABELS: Record<MyListingsFilter, string> = {
  all: SELLER.filterAll,
  active: SELLER.filterActive,
  moderation: SELLER.filterModeration,
  draft: SELLER.filterDraft,
  correction: SELLER.filterCorrection,
};

/** My Listings — owner read model only (never public search). */
export default async function MyListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    redirect("/giris?return_to=%2Fprofil%2Felanlar");
  }
  const params = await searchParams;
  const filter: MyListingsFilter =
    params.filter !== undefined && params.filter in MY_LISTINGS_FILTERS
      ? (params.filter as MyListingsFilter)
      : "all";
  const items = await myListings(auth, filter);

  return (
    <div className="py-8" data-testid="my-listings-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">{UI.myListings}</h1>
        <Link
          href="/elan-yerlesdir"
          className="inline-flex min-h-12 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          {UI.postListing}
        </Link>
      </div>
      <nav aria-label="Filtr" className="mt-4 flex flex-wrap gap-1">
        {(Object.keys(FILTER_LABELS) as MyListingsFilter[]).map((key) => (
          <Link
            key={key}
            href={key === "all" ? "/profil/elanlar" : `/profil/elanlar?filter=${key}`}
            aria-current={key === filter ? "page" : undefined}
            className={`inline-flex min-h-12 items-center rounded-lg px-3 text-sm font-medium ${
              key === filter ? "bg-primary text-white" : "text-navy hover:bg-surface"
            }`}
            data-testid={`filter-${key}`}
          >
            {FILTER_LABELS[key]}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <div className="mt-10 rounded-card border border-line bg-white px-6 py-12 text-center" data-testid="my-listings-empty">
          <p className="text-lg font-semibold text-navy">{SELLER.emptyMyListings}</p>
          <p className="mt-2 text-sm text-muted">{SELLER.emptyMyListingsHint}</p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3" data-testid="my-listings-list">
          {items.map((listing) => (
            <li key={listing.id}>
              <OwnerListingCard listing={listing} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
