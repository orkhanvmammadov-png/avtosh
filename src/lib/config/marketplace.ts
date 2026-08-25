import { z } from "zod";

const schema = z.object({
  MARKETPLACE_PAGE_SIZE: z.coerce.number().int().min(1).max(48).default(24),
  MARKETPLACE_MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(48),
  MARKETPLACE_CACHE_MAX_AGE_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
  MARKETPLACE_CACHE_S_MAXAGE_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
  CONTACT_REVEAL_PER_LISTING_PER_WINDOW: z.coerce.number().int().positive().default(3),
  CONTACT_REVEAL_PER_SOURCE_PER_WINDOW: z.coerce.number().int().positive().default(15),
  CONTACT_REVEAL_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
});

export interface MarketplaceConfig {
  pageSize: number;
  maxPageSize: number;
  /** Cache CEILINGS for public reads; actual lifetime is bounded by business expiry. */
  cacheMaxAgeSeconds: number;
  cacheSMaxAgeSeconds: number;
  /** Technical anti-abuse windows for anonymous contact reveal. */
  contactRevealPerListing: number;
  contactRevealPerSource: number;
  contactRevealWindowSeconds: number;
}

export function marketplaceConfig(): MarketplaceConfig {
  const parsed = schema.parse({
    MARKETPLACE_PAGE_SIZE: process.env.MARKETPLACE_PAGE_SIZE,
    MARKETPLACE_MAX_PAGE_SIZE: process.env.MARKETPLACE_MAX_PAGE_SIZE,
    MARKETPLACE_CACHE_MAX_AGE_SECONDS: process.env.MARKETPLACE_CACHE_MAX_AGE_SECONDS,
    MARKETPLACE_CACHE_S_MAXAGE_SECONDS: process.env.MARKETPLACE_CACHE_S_MAXAGE_SECONDS,
    CONTACT_REVEAL_PER_LISTING_PER_WINDOW: process.env.CONTACT_REVEAL_PER_LISTING_PER_WINDOW,
    CONTACT_REVEAL_PER_SOURCE_PER_WINDOW: process.env.CONTACT_REVEAL_PER_SOURCE_PER_WINDOW,
    CONTACT_REVEAL_WINDOW_SECONDS: process.env.CONTACT_REVEAL_WINDOW_SECONDS,
  });
  return {
    pageSize: parsed.MARKETPLACE_PAGE_SIZE,
    maxPageSize: parsed.MARKETPLACE_MAX_PAGE_SIZE,
    cacheMaxAgeSeconds: parsed.MARKETPLACE_CACHE_MAX_AGE_SECONDS,
    cacheSMaxAgeSeconds: parsed.MARKETPLACE_CACHE_S_MAXAGE_SECONDS,
    contactRevealPerListing: parsed.CONTACT_REVEAL_PER_LISTING_PER_WINDOW,
    contactRevealPerSource: parsed.CONTACT_REVEAL_PER_SOURCE_PER_WINDOW,
    contactRevealWindowSeconds: parsed.CONTACT_REVEAL_WINDOW_SECONDS,
  };
}

export const SEARCH_SORTS = ["NEWEST", "PRICE_ASC", "PRICE_DESC", "YEAR_DESC"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
