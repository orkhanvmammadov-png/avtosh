import Link from "next/link";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { ListingImage } from "@/components/shared/listing-image";
import { Badge } from "@/components/ui/badge";
import { PromotionBadge } from "@/components/ui/promotion-badge";
import { formatFreshness, formatMileage, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { UI } from "@/lib/marketplace/labels";
import type { PublicCardDto } from "@/services/marketplace";

/**
 * Approved frameless listing card (components.md): 16:11 image
 * (16:10 full-width on mobile) with radius 10 sitting directly on the
 * paper ground — no card box, no hover lift; Condensed price +
 * freshness row; title 600; spec line. Badges max 2, PREMIUM before
 * BOOST. `nowMs` is the server-supplied render reference — SSR and
 * hydration compute identical freshness text.
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
    <article data-testid="listing-card" data-public-id={listing.publicId} className="group relative">
      <Link href={`/elan/${listing.publicId}`} className="block focus-visible:outline-offset-2">
        <div className="aspect-gallery relative w-full overflow-hidden rounded-card bg-sunken md:aspect-card">
          <ListingImage
            src={listing.primaryImageUrl}
            alt={`${title} — ${UI.photoOf.toLowerCase()}`}
            priority={priority}
            className="transition-[filter] duration-150 group-hover:brightness-[1.03]"
          />
          {(promotedLabel || listing.badges.premium || listing.badges.boosted) && (
            <div className="absolute left-2 top-2 flex gap-1">
              {/* Boost placements keep the required ad marking ("Reklam")
                  alongside the approved zap chip (documented deviation
                  from zap-only: the existing ad-label contract wins). */}
              {promotedLabel ? <Badge tone="neutral">{promotedLabel}</Badge> : null}
              {!promotedLabel && listing.badges.premium ? <PromotionBadge type="PREMIUM" compact /> : null}
              {promotedLabel || listing.badges.boosted ? <PromotionBadge type="BOOST" compact /> : null}
            </div>
          )}
        </div>
        <div className="pt-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-condensed text-[17px] font-bold leading-tight text-ink md:text-[19px]">
              {formatPriceMinor(listing.priceMinor, listing.currency)}
            </p>
            <p className="shrink-0 text-[11px] tracking-[0.01em] text-muted" data-testid="card-freshness">
              {formatFreshness(listing.publishedAt, nowMs)}
            </p>
          </div>
          <h3 className="mt-0.5 line-clamp-1 text-[13.5px] font-semibold text-ink transition-colors duration-150 group-hover:text-primary">
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-slate-strong">
            {formatMileage(listing.mileage)}
            {listing.city ? ` · ${listing.city}` : ""}
          </p>
        </div>
      </Link>
      <div className="absolute right-2 top-2">
        <FavoriteButton publicId={listing.publicId} />
      </div>
    </article>
  );
}
