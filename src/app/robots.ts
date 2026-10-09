import type { MetadataRoute } from "next";
import { canonicalOrigin } from "@/lib/seo/sitemap";

// Reads NEXT_PUBLIC_APP_URL at request time (builds run without it).
export const dynamic = "force-dynamic";

/**
 * Crawl policy — reviewed deliberately:
 * - /api/ is disallowed: machine endpoints, no indexable HTML.
 * - /moderator and /admin are disallowed: to every crawler they are
 *   plain 404s (staff-only pages render notFound() for anonymous
 *   visitors), so Disallow removes crawl noise and can never hide a
 *   noindex directive that matters.
 * - /profil and /odenis are INTENTIONALLY NOT disallowed: those
 *   pages rely on meta robots noindex, and Google must be able to
 *   crawl a page to see its noindex. Blocking them in robots.txt
 *   would leave the URLs indexable-by-reference. Covered by the
 *   per-page `robots: { index: false }` metadata.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: ["/api/", "/moderator", "/admin"] }],
    sitemap: `${canonicalOrigin()}/sitemap.xml`,
  };
}
