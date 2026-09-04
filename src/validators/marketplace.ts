import { z } from "zod";
import { LISTING_YEAR_MIN, listingYearMax, SEARCH_SORTS } from "@/lib/config/marketplace";

const categoryCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/, "Invalid category code");
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
/** CSV of UUIDs (feature_ids precedent): split, trim, dedupe, validate. */
const csvUuids = (max: number) =>
  z
    .string()
    .max(1200)
    .transform((v) => [...new Set(v.split(",").map((s) => s.trim()).filter((s) => s.length > 0))])
    .pipe(z.array(z.uuid()).min(1).max(max));

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
    year_min: int(LISTING_YEAR_MIN, listingYearMax()).optional(),
    year_max: int(LISTING_YEAR_MIN, listingYearMax()).optional(),
    mileage_max: int(0, 10_000_000).optional(),
    engine_cc_min: int(0, 100_000).optional(),
    engine_cc_max: int(0, 100_000).optional(),
    // Legacy singular params stay accepted (bookmarked URLs); the
    // service merges them into the canonical multi-value arrays.
    fuel_type_id: z.uuid().optional(),
    transmission_id: z.uuid().optional(),
    fuel_type_ids: csvUuids(20).optional(),
    transmission_ids: csvUuids(20).optional(),
    color_ids: csvUuids(30).optional(),
    body_type_id: z.uuid().optional(),
    drive_type_id: z.uuid().optional(),
    motorcycle_type_id: z.uuid().optional(),
    color_id: z.uuid().optional(),
    credit: bool.optional(),
    barter: bool.optional(),
    // Positive-claim condition filters: only TRUE filters; the web UI
    // emits the param only when the claim is selected.
    no_accident: bool.optional(),
    not_repainted: bool.optional(),
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
  })
  .refine(
    (q) => q.engine_cc_min === undefined || q.engine_cc_max === undefined || q.engine_cc_min <= q.engine_cc_max,
    { message: "engine_cc_min must not exceed engine_cc_max", path: ["engine_cc_min"] },
  );

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const premiumQuerySchema = z.object({
  limit: int(1, 48).optional(),
  cursor: z.string().max(300).optional(),
});

export const publicIdParamSchema = z.coerce.number().int().min(1).max(9_007_199_254_740_991);
