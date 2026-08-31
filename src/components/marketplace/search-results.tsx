"use client";

import { useState } from "react";
import { ListingCard } from "@/components/shared/listing-card";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/ui/skeleton";
import { UI } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import { appendUnique, boostSlotClass } from "@/lib/marketplace/search-params";
import type { PublicCardDto } from "@/services/marketplace";

/**
 * First page comes from the server; "Daha çox göstər" appends cursor
 * pages via the public API. Promoted (Boost) cards render above organic
 * results on page 1 only, collapsing to 2/3/4 by viewport.
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

  async function loadMore() {
    if (cursor === null || loading) return;
    setLoading(true);
    setError(false);
    try {
      const { data, meta } = await publicFetch<{ items: PublicCardDto[] }>(
        `/api/v1/listings?${queryString}&cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((current) => appendUnique(current, data.items));
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
      {promoted.length > 0 ? (
        <section aria-labelledby="promoted-title" className="mb-6" data-testid="promoted-section">
          <h2 id="promoted-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{UI.promoted}</h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {promoted.map((item, index) => (
              <li key={item.publicId} className={boostSlotClass(index)} data-testid="promoted-card">
                <ListingCard listing={item} nowMs={renderedAtMs} priority promotedLabel={UI.promoted} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4" data-testid="results-grid">
        {items.map((item, index) => (
          <li key={item.publicId} data-testid="organic-card"><ListingCard listing={item} nowMs={renderedAtMs} priority={promoted.length === 0 && index < 4} /></li>
        ))}
        {loading ? Array.from({ length: 4 }, (_, i) => <li key={`s-${i}`}><CardSkeleton /></li>) : null}
      </ul>
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{UI.errorTitle}. {UI.errorHint}</p> : null}
      {hasMore ? (
        <div className="mt-8 flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loading} className="min-w-48" data-testid="load-more">
            {loading ? UI.loading : UI.showMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
