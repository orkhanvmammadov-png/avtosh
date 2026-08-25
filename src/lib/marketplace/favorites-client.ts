"use client";

import { publicFetch, PublicApiError } from "@/lib/marketplace/public-api";

/**
 * Per-page-load favorite-id cache so many heart buttons share ONE
 * /favorites/ids request. Anonymous (401) resolves to null — hearts
 * stay neutral and clicking routes into the login flow with intent.
 */
let idsPromise: Promise<Set<string> | null> | null = null;

export function getFavoriteIds(): Promise<Set<string> | null> {
  idsPromise ??= publicFetch<{ publicIds: string[] }>("/api/v1/me/favorites/ids")
    .then((r) => new Set(r.data.publicIds))
    .catch((error: unknown) => {
      if (error instanceof PublicApiError && error.status === 401) return null;
      return null;
    });
  return idsPromise;
}

export function invalidateFavoriteIds(): void {
  idsPromise = null;
}

export function loginHrefWithIntent(returnTo: string): string {
  return `/giris?return_to=${encodeURIComponent(returnTo)}`;
}
