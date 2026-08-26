"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { STAFF } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import { QueueCard, type QueueCardItem } from "@/components/moderator/queue-card";

/**
 * Cursor continuation over the accepted keyset-paginated queue.
 * Ordering comes exclusively from the server (oldest first).
 */
export function ModeratorQueueList({
  initialItems,
  initialCursor,
}: {
  initialItems: QueueCardItem[];
  initialCursor: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function loadMore() {
    if (cursor === null || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const { data } = await publicFetch<{ items: QueueCardItem[]; next_cursor: string | null }>(
        `/api/v1/moderator/listings?limit=20&cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((current) => [...current, ...data.items]);
      setCursor(data.next_cursor);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="mt-10 rounded-card border border-line bg-white px-6 py-12 text-center" data-testid="queue-empty">
        <p className="text-lg font-semibold text-navy">{STAFF.queueEmpty}</p>
      </div>
    );
  }

  return (
    <div>
      <ul className="mt-4 space-y-2" data-testid="moderation-queue">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={`/moderator/elanlar/${item.id}`} className="block focus-visible:outline-offset-2">
              <QueueCard item={item} />
            </Link>
          </li>
        ))}
      </ul>
      {failed ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {STAFF.queueError}
        </p>
      ) : null}
      {cursor !== null ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => void loadMore()} disabled={loading} data-testid="queue-load-more">
            {loading ? "…" : STAFF.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
