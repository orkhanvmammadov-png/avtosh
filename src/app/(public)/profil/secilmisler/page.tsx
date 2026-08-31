import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { Badge } from "@/components/ui/badge";
import { AccountNav } from "@/components/seller/account-nav";
import { ListingImage } from "@/components/shared/listing-image";
import { formatMileage, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { UI } from "@/lib/marketplace/labels";
import { myFavoriteCards } from "@/services/favorites";

export const metadata: Metadata = {
  title: `${UI.favorites} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/** Saved listings. Server-fetched for the session user only. */
export default async function FavoritesPage() {
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    redirect("/giris?return_to=%2Fprofil%2Fsecilmisler");
  }
  const items = await myFavoriteCards(auth);
  return (
    <div className="py-6" data-testid="favorites-page">
      <AccountNav active="favorites" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-navy">{UI.favorites}</h1>
      {items.length === 0 ? (
        <div className="mt-10 rounded-card border border-dashed border-line bg-raised px-6 py-12 text-center" data-testid="favorites-empty">
          <p className="text-lg font-semibold text-navy">{UI.favoritesEmpty}</p>
          <p className="mt-2 text-sm text-muted">{UI.favoritesEmptyHint}</p>
          <Link href="/elanlar" className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-white">
            {UI.listings}
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="favorites-grid">
          {items.map((item) => {
            const title = vehicleTitle(item);
            return (
              <li key={item.publicId}>
                <article
                  data-testid="favorite-card"
                  data-public-id={item.publicId}
                  className="group relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-raised shadow-card transition-shadow hover:shadow-raised"
                >
                  <Link href={`/elan/${item.publicId}`} className="flex h-full flex-col focus-visible:outline-offset-[-2px]">
                    <div className="relative aspect-vehicle w-full overflow-hidden bg-sunken">
                      <ListingImage src={item.primaryImageUrl} alt={`${title} — ${UI.photoOf.toLowerCase()}`} />
                      {!item.isActive ? (
                        <div className="absolute left-2 top-2">
                          <Badge tone="expired">{UI.listingInactive}</Badge>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-4">
                      <h2 className="line-clamp-1 text-base font-semibold text-navy">{title}</h2>
                      <p className="text-lg font-bold text-primary">{formatPriceMinor(item.priceMinor, item.currency)}</p>
                      <p className="text-sm text-muted">
                        {formatMileage(item.mileage)}
                        {item.city ? ` · ${item.city}` : ""}
                      </p>
                    </div>
                  </Link>
                  <div className="absolute right-2 top-2">
                    <FavoriteButton publicId={item.publicId} />
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
