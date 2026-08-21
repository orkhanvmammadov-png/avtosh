import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ListingImage } from "@/components/shared/listing-image";
import { formatFreshness, formatMileage, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { UI } from "@/lib/marketplace/labels";
import type { PublicCardDto } from "@/services/marketplace";

/** The one public listing card. Reflects the public DTO only. */
export function ListingCard({
  listing,
  priority = false,
  promotedLabel,
}: {
  listing: PublicCardDto;
  priority?: boolean;
  promotedLabel?: string;
}) {
  const title = vehicleTitle(listing);
  return (
    <article
      data-testid="listing-card"
      data-public-id={listing.publicId}
      className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-white transition-shadow hover:shadow-md"
    >
      <Link href={`/elan/${listing.publicId}`} className="flex h-full flex-col focus-visible:outline-offset-[-2px]">
        <div className="relative aspect-vehicle w-full overflow-hidden bg-line/40">
          <ListingImage src={listing.primaryImageUrl} alt={`${title} — ${UI.photoOf.toLowerCase()}`} priority={priority} />
          {(promotedLabel || listing.badges.premium || listing.badges.boosted) && (
            <div className="absolute left-2 top-2 flex gap-1">
              {promotedLabel ? <Badge tone="boosted">{promotedLabel}</Badge> : null}
              {listing.badges.premium ? <Badge tone="premium">{UI.premiumBadge}</Badge> : null}
              {!promotedLabel && listing.badges.boosted ? <Badge tone="boosted">{UI.boostedBadge}</Badge> : null}
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-4">
          <h3 className="line-clamp-1 text-base font-semibold text-navy">{title}</h3>
          <p className="text-lg font-bold text-primary">{formatPriceMinor(listing.priceMinor, listing.currency)}</p>
          <p className="text-sm text-muted">
            {formatMileage(listing.mileage)}
            {listing.city ? ` · ${listing.city}` : ""}
          </p>
          <p className="mt-auto pt-2 text-xs text-muted">{formatFreshness(listing.publishedAt)}</p>
        </div>
      </Link>
    </article>
  );
}
