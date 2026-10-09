import "server-only";
import type { MetadataRoute } from "next";
import type { Sql } from "@/lib/server/db/client";
import { publicVisible } from "@/repositories/marketplace";

/**
 * Sitemap assembly. URL policy: canonical HTTPS www origin only
 * (from NEXT_PUBLIC_APP_URL — https://www.avtosh.az in production).
 *
 * Inclusion = EXACTLY the public visibility invariant the listing
 * service uses (publicVisible: ACTIVE, unexpired, not
 * seller-deactivated) — drafts, pending moderation, expired,
 * suspended, sold and deactivated listings are excluded by
 * construction, not by a second predicate that could drift.
 *
 * Size bound: Google caps one sitemap at 50,000 URLs / 50 MB. We cap
 * the query at 45,000 newest-published listings (each entry is well
 * under 200 bytes, so ~9 MB worst case). If the marketplace ever
 * approaches that bound, migrate to Next's generateSitemaps() with a
 * sitemap index — the single-file shape here is deliberate for the
 * current scale, and the cap keeps the route correct (newest
 * listings always discoverable) rather than oversized.
 */

export const SITEMAP_LISTING_CAP = 45_000;

export interface SitemapListingRow {
  public_id: string;
  updated_at: Date;
}

export async function listSitemapListings(sql: Sql): Promise<SitemapListingRow[]> {
  return sql<SitemapListingRow[]>`
    select l.public_id::text as public_id, l.updated_at
    from listings l
    where ${publicVisible(sql)}
    order by l.published_at desc nulls last
    limit ${SITEMAP_LISTING_CAP}
  `;
}

/** The canonical HTTPS origin; fails loudly when unconfigured in
    production (same checkpoint philosophy as metadataBase). */
export function canonicalOrigin(): string {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (origin === undefined) {
    throw new Error("NEXT_PUBLIC_APP_URL must be configured to build sitemap/robots URLs.");
  }
  return origin.replace(/\/$/, "");
}

/**
 * Static canonical pages carry NO lastModified — we will not invent
 * timestamps for pages whose change cadence we do not track. Listing
 * entries use listings.updated_at, which the row trigger bumps on
 * every real content/status change.
 */
export function buildSitemapEntries(
  origin: string,
  listings: SitemapListingRow[],
): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${origin}/` },
    { url: `${origin}/elanlar?category=CAR` },
    { url: `${origin}/elanlar?category=MOTORCYCLE` },
    { url: `${origin}/qaydalar` },
    { url: `${origin}/istifadeci-razilasmasi` },
    { url: `${origin}/mexfilik-siyaseti` },
  ];
  return [
    ...staticPages,
    ...listings.map((row) => ({
      url: `${origin}/elan/${row.public_id}`,
      lastModified: row.updated_at,
    })),
  ];
}
