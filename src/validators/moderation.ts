import { z } from "zod";
import {
  MODERATION_NOTE_MAX_LENGTH,
  MODERATION_REASON_CODES,
} from "@/lib/config/moderation";

export const moderationQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export const approveSchema = z
  .object({ expected_revision: z.number().int().min(1) })
  .strict();

/** Reject / correction: controlled reason code + bounded plain-text note. */
export const decisionWithReasonSchema = z
  .object({
    expected_revision: z.number().int().min(1),
    reason_code: z.enum(MODERATION_REASON_CODES),
    note: z.string().trim().min(1).max(MODERATION_NOTE_MAX_LENGTH).optional(),
  })
  .strict();
