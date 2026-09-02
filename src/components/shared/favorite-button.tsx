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
  // Until the shared ids fetch resolves, the state is UNKNOWN — the
  // button stays disabled (a click would otherwise toggle from an
  // assumed "false" and could send the opposite mutation) and the DOM
  // says so honestly instead of claiming "false".
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={busy || favorited === null}
      data-testid="favorite-button"
      data-favorited={favorited === null ? "unknown" : active ? "true" : "false"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      className={`inline-flex items-center justify-center rounded-full bg-white/90 transition-colors duration-150 ${
        size === "lg" ? "min-h-12 min-w-12 border border-line" : "h-7 w-7 md:h-[30px] md:w-[30px]"
      } ${active ? "text-[#B3261E]" : "text-slate-strong hover:text-[#B3261E]"}`}
    >
      <svg width={size === "lg" ? 20 : 15} height={size === "lg" ? 20 : 15} viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      </svg>
    </button>
  );
}
