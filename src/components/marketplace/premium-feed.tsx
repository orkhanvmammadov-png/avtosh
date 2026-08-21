"use client";

import { useState } from "react";
import { ListingCard } from "@/components/shared/listing-card";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/ui/skeleton";
import { UI } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import { appendUnique } from "@/lib/marketplace/search-params";
import type { PublicCardDto } from "@/services/marketplace";

/** Premium has no slot cap: first page from the server, the rest lazily via cursor. */
export function PremiumFeed({
  initialItems,
  initialCursor,
  initialHasMore,
}: {
  initialItems: PublicCardDto[];
  initialCursor: string | null;
  initialHasMore: boolean;
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
        `/api/v1/listings/premium?cursor=${encodeURIComponent(cursor)}`,
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
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" data-testid="premium-grid">
        {items.map((item, index) => (
          <li key={item.publicId}><ListingCard listing={item} priority={index < 4} /></li>
        ))}
        {loading ? Array.from({ length: 4 }, (_, i) => <li key={`s-${i}`}><CardSkeleton /></li>) : null}
      </ul>
      {error ? <p role="alert" className="mt-4 text-sm text-danger">{UI.errorTitle}. {UI.errorHint}</p> : null}
      {hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loading} data-testid="premium-load-more">
            {loading ? UI.loading : UI.showMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
