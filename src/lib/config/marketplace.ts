import { z } from "zod";

const schema = z.object({
  MARKETPLACE_PAGE_SIZE: z.coerce.number().int().min(1).max(48).default(24),
  MARKETPLACE_MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(48),
  MARKETPLACE_CACHE_CONTROL: z
    .string()
    .default("public, max-age=30, s-maxage=60, stale-while-revalidate=30"),
});

export interface MarketplaceConfig {
  pageSize: number;
  maxPageSize: number;
  /** Applied only to anonymous public read responses. */
  cacheControl: string;
}

export function marketplaceConfig(): MarketplaceConfig {
  const parsed = schema.parse({
    MARKETPLACE_PAGE_SIZE: process.env.MARKETPLACE_PAGE_SIZE,
    MARKETPLACE_MAX_PAGE_SIZE: process.env.MARKETPLACE_MAX_PAGE_SIZE,
    MARKETPLACE_CACHE_CONTROL: process.env.MARKETPLACE_CACHE_CONTROL,
  });
  return {
    pageSize: parsed.MARKETPLACE_PAGE_SIZE,
    maxPageSize: parsed.MARKETPLACE_MAX_PAGE_SIZE,
    cacheControl: parsed.MARKETPLACE_CACHE_CONTROL,
  };
}

export const SEARCH_SORTS = ["NEWEST", "PRICE_ASC", "PRICE_DESC", "YEAR_DESC"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
