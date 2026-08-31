import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { ListingImage } from "@/components/shared/listing-image";
import { formatFreshness, formatMileage, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { UI } from "@/lib/marketplace/labels";
import type { PublicCardDto } from "@/services/marketplace";

/**
 * The one public listing card. Reflects the public DTO only.
 * `nowMs` is the server-supplied render reference for the freshness
 * label — the SAME value reaches SSR and hydration via props, so the
 * first client render is byte-identical to the server HTML.
 */
export function ListingCard({
  listing,
  nowMs,
  priority = false,
  promotedLabel,
}: {
  listing: PublicCardDto;
  nowMs: number;
  priority?: boolean;
  promotedLabel?: string;
}) {
  const title = vehicleTitle(listing);
  return (
    <article
      data-testid="listing-card"
      data-public-id={listing.publicId}
      className="group relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-raised shadow-card transition-shadow hover:shadow-raised"
    >
      <Link href={`/elan/${listing.publicId}`} className="flex h-full flex-col focus-visible:outline-offset-[-2px]">
        <div className="relative aspect-vehicle w-full overflow-hidden bg-sunken">
          <ListingImage src={listing.primaryImageUrl} alt={`${title} — ${UI.photoOf.toLowerCase()}`} priority={priority} />
          {(promotedLabel || listing.badges.premium || listing.badges.boosted) && (
            <div className="absolute left-2 top-2 flex gap-1">
              {promotedLabel ? <Badge tone="boosted">{promotedLabel}</Badge> : null}
              {listing.badges.premium ? <Badge tone="premium">{UI.premiumBadge}</Badge> : null}
              {!promotedLabel && listing.badges.boosted ? <Badge tone="boosted">{UI.boostedBadge}</Badge> : null}
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3.5">
          <p className="text-lg font-extrabold tracking-tight text-primary">
            {formatPriceMinor(listing.priceMinor, listing.currency)}
          </p>
          <h3 className="line-clamp-1 text-sm font-semibold text-navy">{title}</h3>
          <p className="text-xs text-muted">
            {formatMileage(listing.mileage)}
            {listing.city ? ` · ${listing.city}` : ""}
          </p>
          <p className="mt-auto pt-2 text-xs text-faint" data-testid="card-freshness">
            {formatFreshness(listing.publishedAt, nowMs)}
          </p>
        </div>
      </Link>
      <div className="absolute right-2 top-2">
        <FavoriteButton publicId={listing.publicId} />
      </div>
    </article>
  );
}
