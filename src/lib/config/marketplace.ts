import { z } from "zod";

const schema = z.object({
  MARKETPLACE_PAGE_SIZE: z.coerce.number().int().min(1).max(48).default(24),
  MARKETPLACE_MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(48),
  MARKETPLACE_CACHE_MAX_AGE_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
  MARKETPLACE_CACHE_S_MAXAGE_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
});

export interface MarketplaceConfig {
  pageSize: number;
  maxPageSize: number;
  /** Cache CEILINGS for public reads; actual lifetime is bounded by business expiry. */
  cacheMaxAgeSeconds: number;
  cacheSMaxAgeSeconds: number;
}

export function marketplaceConfig(): MarketplaceConfig {
  const parsed = schema.parse({
    MARKETPLACE_PAGE_SIZE: process.env.MARKETPLACE_PAGE_SIZE,
    MARKETPLACE_MAX_PAGE_SIZE: process.env.MARKETPLACE_MAX_PAGE_SIZE,
    MARKETPLACE_CACHE_MAX_AGE_SECONDS: process.env.MARKETPLACE_CACHE_MAX_AGE_SECONDS,
    MARKETPLACE_CACHE_S_MAXAGE_SECONDS: process.env.MARKETPLACE_CACHE_S_MAXAGE_SECONDS,
  });
  return {
    pageSize: parsed.MARKETPLACE_PAGE_SIZE,
    maxPageSize: parsed.MARKETPLACE_MAX_PAGE_SIZE,
    cacheMaxAgeSeconds: parsed.MARKETPLACE_CACHE_MAX_AGE_SECONDS,
    cacheSMaxAgeSeconds: parsed.MARKETPLACE_CACHE_S_MAXAGE_SECONDS,
  };
}

export const SEARCH_SORTS = ["NEWEST", "PRICE_ASC", "PRICE_DESC", "YEAR_DESC"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
