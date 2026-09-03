import { z } from "zod";
import { LISTING_YEAR_MAX, LISTING_YEAR_MIN, SEARCH_SORTS } from "@/lib/config/marketplace";

const categoryCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/, "Invalid category code");
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

/**
 * Public search query. Values are validated by shape here; catalog
 * relationships (brand∈category, model∈brand, option scope, features)
 * are verified against current catalog data by the service.
 */
export const searchQuerySchema = z
  .object({
    category: categoryCode,
    brand_id: z.uuid().optional(),
    model_id: z.uuid().optional(),
    city_id: z.uuid().optional(),
    price_min: int(1, 9_000_000_000_000).optional(),
    price_max: int(1, 9_000_000_000_000).optional(),
    year_min: int(LISTING_YEAR_MIN, LISTING_YEAR_MAX).optional(),
    year_max: int(LISTING_YEAR_MIN, LISTING_YEAR_MAX).optional(),
    mileage_max: int(0, 10_000_000).optional(),
    fuel_type_id: z.uuid().optional(),
    transmission_id: z.uuid().optional(),
    body_type_id: z.uuid().optional(),
    drive_type_id: z.uuid().optional(),
    motorcycle_type_id: z.uuid().optional(),
    color_id: z.uuid().optional(),
    credit: bool.optional(),
    barter: bool.optional(),
    feature_ids: z
      .string()
      .max(1200)
      .transform((v) => v.split(",").map((s) => s.trim()).filter((s) => s.length > 0))
      .pipe(z.array(z.uuid()).min(1).max(30))
      .optional(),
    sort: z.enum(SEARCH_SORTS).default("NEWEST"),
    limit: int(1, 48).optional(),
    cursor: z.string().max(300).optional(),
  })
  .refine((q) => q.price_min === undefined || q.price_max === undefined || q.price_min <= q.price_max, {
    message: "price_min must not exceed price_max",
    path: ["price_min"],
  })
  .refine((q) => q.year_min === undefined || q.year_max === undefined || q.year_min <= q.year_max, {
    message: "year_min must not exceed year_max",
    path: ["year_min"],
  });

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const premiumQuerySchema = z.object({
  limit: int(1, 48).optional(),
  cursor: z.string().max(300).optional(),
});

export const publicIdParamSchema = z.coerce.number().int().min(1).max(9_007_199_254_740_991);
