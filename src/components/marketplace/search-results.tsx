"use client";

import { useState } from "react";
import { ListingCard } from "@/components/shared/listing-card";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/ui/skeleton";
import { UI } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import { appendUnique, BOOST_VISIBLE_SLOTS, boostSlotClass } from "@/lib/marketplace/search-params";
import type { PublicCardDto } from "@/services/marketplace";

/**
 * O.6 single boost-first results grid. The first page comes from the
 * server: `promoted` (existing deterministic rotation, already
 * EXCLUDED from the organic first page server-side) leads the grid in
 * service order, capped per viewport by the existing slot classes
 * (4 / 3 / 2); organic results continue immediately after with no
 * separator. "Daha çox göstər" appends organic cursor pages only —
 * boost is never re-inserted.
 */
export function SearchResults({
  queryString,
  promoted,
  initialItems,
  initialCursor,
  initialHasMore,
  renderedAtMs,
}: {
  queryString: string;
  promoted: PublicCardDto[];
  initialItems: PublicCardDto[];
  initialCursor: string | null;
  initialHasMore: boolean;
  /** Server render timestamp — hydration-safe freshness reference. */
  renderedAtMs: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  /**
   * Dedupe identity set for continuation pages: the VISIBLE boost
   * slots at the current viewport. A promoted candidate hidden by the
   * responsive slot cap stays reachable organically (pre-existing
   * slot-visibility limitation — deliberately not made worse here);
   * a visibly boosted listing never re-appears as organic.
   */
  function visiblePromotedIds(): Set<string> {
    const slots =
      window.matchMedia("(min-width: 1024px)").matches ? BOOST_VISIBLE_SLOTS.desktop
      : window.matchMedia("(min-width: 768px)").matches ? BOOST_VISIBLE_SLOTS.tablet
      : BOOST_VISIBLE_SLOTS.mobile;
    return new Set(promoted.slice(0, slots).map((p) => p.publicId));
  }

  async function loadMore() {
    if (cursor === null || loading) return;
    setLoading(true);
    setError(false);
    try {
      const { data, meta } = await publicFetch<{ items: PublicCardDto[] }>(
        `/api/v1/listings?${queryString}&cursor=${encodeURIComponent(cursor)}`,
      );
      const boosted = visiblePromotedIds();
      setItems((current) => appendUnique(current, data.items.filter((item) => !boosted.has(item.publicId))));
      setCursor(meta?.next_cursor ?? null);
      setHasMore(meta?.has_more ?? false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <ul
        className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-3 desk:gap-3.5 xl:grid-cols-4 xl:gap-x-[18px] xl:gap-y-4"
        data-testid="results-grid"
      >
        {promoted.map((item, index) => (
          <li key={item.publicId} className={boostSlotClass(index)} data-testid="promoted-card">
            <ListingCard listing={item} nowMs={renderedAtMs} priority />
          </li>
        ))}
        {items.map((item, index) => (
          <li key={item.publicId} data-testid="organic-card">
            <ListingCard listing={item} nowMs={renderedAtMs} priority={promoted.length === 0 && index < 4} />
          </li>
        ))}
        {loading ? Array.from({ length: 4 }, (_, i) => <li key={`s-${i}`}><CardSkeleton /></li>) : null}
      </ul>
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{UI.errorTitle}. {UI.errorHint}</p> : null}
      {hasMore ? (
        <div className="mt-5 flex justify-center md:mt-6">
          <Button variant="secondary" onClick={loadMore} disabled={loading} className="min-w-48 max-sm:w-full" data-testid="load-more">
            {loading ? UI.loading : UI.showMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
