import { z } from "zod";
import { ACCEPTED_IMAGE_MIME_TYPES } from "@/lib/config/listing-images";

/**
 * Owner listing-draft schemas. The PATCH schema is strict(): unknown
 * body properties are REJECTED (explicit policy — autosave clients
 * must never silently lose fields), and only the allowlisted
 * seller-editable draft fields exist. Nothing here is ever spread
 * into SQL directly; the service maps validated fields to columns.
 */

const categoryCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,31}$/, "Invalid category code format");

export const createDraftSchema = z
  .object({
    category: categoryCode,
  })
  .strict();

export const draftPatchSchema = z
  .object({
    expected_revision: z.number().int().min(1),
    category: categoryCode.optional(),
    brand_id: z.uuid().nullable().optional(),
    model_id: z.uuid().nullable().optional(),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    price_minor: z
      .number()
      .int()
      .min(1)
      .max(9_000_000_000_000)
      .nullable()
      .optional(),
    mileage: z.number().int().min(0).max(10_000_000).nullable().optional(),
    engine_cc: z.number().int().min(0).max(100_000).nullable().optional(),
    fuel_type_id: z.uuid().nullable().optional(),
    transmission_id: z.uuid().nullable().optional(),
    body_type_id: z.uuid().nullable().optional(),
    drive_type_id: z.uuid().nullable().optional(),
    motorcycle_type_id: z.uuid().nullable().optional(),
    color_id: z.uuid().nullable().optional(),
    city_id: z.uuid().nullable().optional(),
    credit_available: z.boolean().optional(),
    barter_available: z.boolean().optional(),
    description: z.string().max(5000).nullable().optional(),
    contact_phone: z.string().max(32).nullable().optional(),
    feature_ids: z.array(z.uuid()).max(100).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 1,
    "At least one editable field is required.",
  );

export type DraftPatchInput = z.infer<typeof draftPatchSchema>;

export const uploadUrlSchema = z
  .object({
    filename: z.string().max(255).optional(),
    declared_mime_type: z.enum(ACCEPTED_IMAGE_MIME_TYPES),
    declared_size_bytes: z.number().int().min(1),
  })
  .strict();

export const confirmUploadSchema = z
  .object({
    upload_id: z.uuid(),
  })
  .strict();

export const reorderImagesSchema = z
  .object({
    image_ids: z
      .array(z.uuid())
      .min(1)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Duplicate image IDs are not allowed.",
      ),
  })
  .strict();

export const submitListingSchema = z
  .object({
    expected_revision: z.number().int().min(1),
  })
  .strict();

export const resubmitListingSchema = submitListingSchema;

export const myListingsQuerySchema = z
  .object({
    filter: z
      .enum(["all", "active", "moderation", "draft", "correction"])
      .default("all"),
  })
  .strict();
