import { z } from "zod";

const schema = z.object({
  MODERATION_CLAIM_TTL_SECONDS: z.coerce.number().int().positive().default(600),
});

/** Soft-claim lifetime (default 10 minutes). Read per call; test-friendly. */
export function moderationConfig(): { claimTtlSeconds: number } {
  const parsed = schema.parse({
    MODERATION_CLAIM_TTL_SECONDS: process.env.MODERATION_CLAIM_TTL_SECONDS,
  });
  return { claimTtlSeconds: parsed.MODERATION_CLAIM_TTL_SECONDS };
}

/** Controlled reason codes for reject / correction decisions. */
export const MODERATION_REASON_CODES = [
  "INVALID_PHOTOS",
  "MISLEADING_INFO",
  "WRONG_CATEGORY",
  "DUPLICATE_LISTING",
  "PROHIBITED_ITEM",
  "INCOMPLETE_INFO",
  "SUSPICIOUS_PRICE",
  "CONTACT_ISSUE",
  "OTHER",
] as const;

export const MODERATION_NOTE_MAX_LENGTH = 1000;
