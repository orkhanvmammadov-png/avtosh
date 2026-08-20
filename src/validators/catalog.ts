import { z } from "zod";

/**
 * Query-parameter schemas for the public catalog API. Codes are
 * validated by shape here; existence/activity is resolved against the
 * database by the catalog service.
 */

const categoryCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,31}$/, "Invalid category code format");

const referenceGroupCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,63}$/, "Invalid reference group code format");

export const brandsQuerySchema = z.object({
  category: categoryCode,
});

export const modelsQuerySchema = z.object({
  category: categoryCode,
  brand_id: z.uuid("brand_id must be a UUID"),
});

export const optionsQuerySchema = z.object({
  group: referenceGroupCode,
  category: categoryCode.optional(),
});

export const featuresQuerySchema = z.object({
  category: categoryCode.optional(),
});
