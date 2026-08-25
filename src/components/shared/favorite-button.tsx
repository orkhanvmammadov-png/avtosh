"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UI } from "@/lib/marketplace/labels";
import {
  getFavoriteIds,
  invalidateFavoriteIds,
  loginHrefWithIntent,
} from "@/lib/marketplace/favorites-client";
import { publicFetch, PublicApiError } from "@/lib/marketplace/public-api";

/**
 * Heart control for cards and detail. Anonymous click → /giris with
 * `return_to=/elan/{id}?fav=1`; after login the detail page's button
 * sees fav=1 and completes the intended add automatically.
 */
export function FavoriteButton({
  publicId,
  size = "sm",
  autoIntent = false,
}: {
  publicId: string;
  size?: "sm" | "lg";
  autoIntent?: boolean;
}) {
  const router = useRouter();
  const [favorited, setFavorited] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const intentDone = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getFavoriteIds().then((ids) => {
      if (cancelled) return;
      const isFav = ids?.has(publicId) ?? false;
      setFavorited(ids === null ? false : isFav);
      // Complete a preserved favorite intent exactly once (?fav=1).
      // window.location (not useSearchParams) so cards never force a
      // Suspense boundary onto otherwise-static pages.
      const wantsFav = new URLSearchParams(window.location.search).get("fav") === "1";
      if (autoIntent && !intentDone.current && ids !== null && !isFav && wantsFav) {
        intentDone.current = true;
        void toggle(true, true);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicId]);

  async function toggle(nextState?: boolean, fromIntent = false) {
    if (busy) return;
    const target = nextState ?? !(favorited ?? false);
    setBusy(true);
    try {
      await publicFetch<{ favorited: boolean }>(`/api/v1/me/favorites/${encodeURIComponent(publicId)}`, {
        method: target ? "PUT" : "DELETE",
      });
      setFavorited(target);
      invalidateFavoriteIds();
      if (fromIntent) {
        router.replace(`/elan/${publicId}`); // clean ?fav=1 from the URL
      }
    } catch (error) {
      if (error instanceof PublicApiError && error.status === 401) {
        router.push(loginHrefWithIntent(`/elan/${publicId}?fav=1`));
      }
    } finally {
      setBusy(false);
    }
  }

  const active = favorited === true;
  const label = active ? UI.removeFavorite : UI.addFavorite;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={busy}
      data-testid="favorite-button"
      data-favorited={active ? "true" : "false"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      className={`inline-flex items-center justify-center rounded-full border bg-white/95 shadow-sm transition-colors ${
        size === "lg" ? "min-h-12 min-w-12" : "h-12 w-12"
      } ${active ? "border-danger text-danger" : "border-line text-muted hover:text-danger"}`}
    >
      <svg width={size === "lg" ? 24 : 20} height={size === "lg" ? 24 : 20} viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 21s-7.5-4.6-10-9.2C.4 8.6 2.3 5 5.7 5c2 0 3.4 1.1 4.3 2.6h4C14.9 6.1 16.3 5 18.3 5c3.4 0 5.3 3.6 3.7 6.8C19.5 16.4 12 21 12 21z" />
      </svg>
    </button>
  );
}
