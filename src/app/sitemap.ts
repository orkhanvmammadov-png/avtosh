import type { MetadataRoute } from "next";
import { getSql } from "@/lib/server/db/client";
import { buildSitemapEntries, canonicalOrigin, listSitemapListings } from "@/lib/seo/sitemap";

// DB-backed: must never execute at build time (CI builds run without
// DATABASE_URL); crawlers fetch this occasionally, so one indexed
// query per request is the whole runtime cost.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const listings = await listSitemapListings(getSql());
  return buildSitemapEntries(canonicalOrigin(), listings);
}
