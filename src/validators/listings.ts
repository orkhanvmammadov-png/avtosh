import { z } from "zod";
import { LISTING_YEAR_MIN, listingYearMax } from "@/lib/config/marketplace";
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

/** Seller-editable content fields shared by the draft PATCH and the
    O.12 edit-revision PATCH (identical field semantics by contract). */
const sellerContentPatchFields = {
  expected_revision: z.number().int().min(1),
  category: categoryCode.optional(),
    brand_id: z.uuid().nullable().optional(),
    model_id: z.uuid().nullable().optional(),
    year: z.number().int().min(LISTING_YEAR_MIN).max(listingYearMax()).nullable().optional(),
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
    // Positive seller claims (4.17O.2): checked → true, unchecked →
    // null. FALSE is never stored — absence of a claim is not a
    // factual negative.
    no_accident: z.union([z.literal(true), z.null()]).optional(),
    not_repainted: z.union([z.literal(true), z.null()]).optional(),
    description: z.string().max(5000).nullable().optional(),
    contact_phone: z.string().max(32).nullable().optional(),
    // O.9 AXIN: listing-level public seller name (trimmed in the
    // service; empty becomes null).
    seller_name: z.string().max(100).nullable().optional(),
    feature_ids: z.array(z.uuid()).max(100).optional(),
} as const;

const atLeastOneField = (value: Record<string, unknown>): boolean =>
  Object.keys(value).length > 1;

export const draftPatchSchema = z
  .object({
    ...sellerContentPatchFields,
    // Per-type promotion intent PREFERENCES (never a payment source of
    // truth) — draft-only; sealed OUT of the edit-revision field space.
    premium_intent_package_id: z.uuid().nullable().optional(),
    boost_intent_package_id: z.uuid().nullable().optional(),
  })
  .strict()
  .refine(atLeastOneField, "At least one editable field is required.");

export type DraftPatchInput = z.infer<typeof draftPatchSchema>;

/**
 * O.12 edit-revision PATCH: the same seller field semantics as the
 * draft PATCH, with `expected_revision` addressing the EDIT revision's
 * own counter and no promotion-intent fields.
 */
export const editPatchSchema = z
  .object(sellerContentPatchFields)
  .strict()
  .refine(atLeastOneField, "At least one editable field is required.");

export type EditPatchInput = z.infer<typeof editPatchSchema>;

/** O.12 edit submit: `activate` records the reactivation intent for
    the approved combined "göndər və aktivləşdir" flow. */
export const editSubmitSchema = z
  .object({
    expected_revision: z.number().int().min(1),
    activate: z.boolean().optional(),
  })
  .strict();

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

/** O.12 seller lifecycle actions (deactivate/reactivate). */
export const lifecycleActionSchema = z
  .object({ expected_revision: z.number().int().min(1) })
  .strict();

export const resubmitListingSchema = submitListingSchema;

export const myListingsQuerySchema = z
  .object({
    filter: z
      .enum(["all", "active", "moderation", "draft", "correction"])
      .default("all"),
  })
  .strict();
