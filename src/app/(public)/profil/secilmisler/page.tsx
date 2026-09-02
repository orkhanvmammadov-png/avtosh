import type { Metadata } from "next";
import { Container } from "@/components/ui/container";
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
    <Container>
    <div className="py-6" data-testid="favorites-page">
      <AccountNav active="favorites" />
      <h1 className="mt-6 text-xl font-bold tracking-[-0.01em] text-ink md:text-2xl">{UI.favorites}</h1>
      {items.length === 0 ? (
        <div className="mt-10 rounded-card border border-dashed border-line-strong bg-raised px-6 py-12 text-center" data-testid="favorites-empty">
          <p className="text-lg font-semibold text-ink">{UI.favoritesEmpty}</p>
          <p className="mt-2 text-sm text-slate-strong">{UI.favoritesEmptyHint}</p>
          <Link href="/elanlar" className="mt-6 inline-flex min-h-12 items-center rounded-control bg-primary px-5 text-sm font-semibold tracking-[0.01em] text-white transition-colors duration-150 hover:bg-primary-hover">
            {UI.listings}
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4" data-testid="favorites-grid">
          {items.map((item) => {
            const title = vehicleTitle(item);
            return (
              <li key={item.publicId}>
                <article
                  data-testid="favorite-card"
                  data-public-id={item.publicId}
                  className="group relative"
                >
                  <Link href={`/elan/${item.publicId}`} className="flex h-full flex-col rounded-card focus-visible:outline-offset-2">
                    <div className="relative aspect-gallery w-full overflow-hidden rounded-card bg-sunken md:aspect-card">
                      <ListingImage src={item.primaryImageUrl} alt={`${title} — ${UI.photoOf.toLowerCase()}`} className="transition-[filter] duration-150 group-hover:brightness-[1.03]" />
                      {!item.isActive ? (
                        <div className="absolute left-2 top-2">
                          <Badge tone="expired">{UI.listingInactive}</Badge>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-col gap-0.5 pt-2.5">
                      <p className="font-condensed text-[17px] font-bold leading-tight text-ink md:text-[19px]">{formatPriceMinor(item.priceMinor, item.currency)}</p>
                      <h2 className="line-clamp-1 text-[13.5px] font-semibold text-ink transition-colors duration-150 group-hover:text-primary">{title}</h2>
                      <p className="text-xs text-slate-strong">
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
  </Container>
  );
}
