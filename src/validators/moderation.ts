import { z } from "zod";
import {
  MODERATION_NOTE_MAX_LENGTH,
  MODERATION_REASON_CODES,
} from "@/lib/config/moderation";
import { sellerContentPatchFields } from "@/validators/listings";

export const moderationQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export const approveSchema = z
  .object({
    expected_revision: z.number().int().min(1),
    /** O.13 Stage C: required to match when an OPEN adjustment exists
        (the server refuses otherwise); absent for plain decisions. */
    expected_adjustment_revision: z.number().int().min(1).optional(),
  })
  .strict();

/** Reject / correction: controlled reason code + bounded plain-text note. */
export const decisionWithReasonSchema = z
  .object({
    expected_revision: z.number().int().min(1),
    reason_code: z.enum(MODERATION_REASON_CODES),
    note: z.string().trim().min(1).max(MODERATION_NOTE_MAX_LENGTH).optional(),
    expected_adjustment_revision: z.number().int().min(1).optional(),
  })
  .strict();

/** O.12 edit-revision decisions: addressed by the EDIT revision's own
    counter (never listings.revision). */
export const editApproveSchema = z
  .object({
    expected_edit_revision: z.number().int().min(1),
    /** O.13 Stage D: required to match when an OPEN adjustment exists. */
    expected_adjustment_revision: z.number().int().min(1).optional(),
  })
  .strict();

export const editDecisionWithReasonSchema = z
  .object({
    expected_edit_revision: z.number().int().min(1),
    reason_code: z.enum(MODERATION_REASON_CODES),
    note: z.string().trim().min(1).max(MODERATION_NOTE_MAX_LENGTH).optional(),
    expected_adjustment_revision: z.number().int().min(1).optional(),
  })
  .strict();

/**
 * O.13 Stage B — moderator adjustment save. The content object is the
 * SAME seller field space as the edit-revision PATCH (strict — no
 * lifecycle/payment/admin key can even parse), addressed by three
 * counters with their original meanings: the moderation subject
 * (listing revision + optional edit revision id/no) and the
 * adjustment's own optimistic revision (null = first save).
 */
const adjustmentContentSchema = z
  .object(sellerContentPatchFields)
  .omit({ expected_revision: true })
  .strict();

export const adjustmentImagePlanEntrySchema = z
  .object({
    source_id: z.uuid(),
    removed: z.boolean(),
    is_primary: z.boolean(),
  })
  .strict();

export const adjustmentSaveSchema = z
  .object({
    expected_listing_revision: z.number().int().min(1),
    edit_revision_id: z.uuid().optional(),
    expected_edit_revision: z.number().int().min(1).optional(),
    expected_adjustment_revision: z.number().int().min(1).nullable(),
    content: adjustmentContentSchema,
    image_plan: z.array(adjustmentImagePlanEntrySchema).max(50),
  })
  .strict()
  .refine(
    (value) => (value.edit_revision_id === undefined) === (value.expected_edit_revision === undefined),
    "edit_revision_id and expected_edit_revision must be provided together.",
  );

export type AdjustmentSaveInput = z.infer<typeof adjustmentSaveSchema>;
export type AdjustmentContentInput = AdjustmentSaveInput["content"];
export type AdjustmentImagePlanEntry = z.infer<typeof adjustmentImagePlanEntrySchema>;

export const adjustmentDiscardSchema = z
  .object({ expected_adjustment_revision: z.number().int().min(1) })
  .strict();
