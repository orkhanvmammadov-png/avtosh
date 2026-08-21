/**
 * Seller-editable pre-publication states. Content/image mutations by
 * the owner are allowed ONLY here (Phase 4.7 extends the original
 * DRAFT-only rule to moderator-returned listings). ACTIVE editing is
 * a later phase with its own risk-based rules.
 */
export const SELLER_EDITABLE_STATUSES = [
  "DRAFT",
  "CORRECTION_REQUIRED",
  "REJECTED",
] as const;

export function isSellerEditable(status: string): boolean {
  return (SELLER_EDITABLE_STATUSES as readonly string[]).includes(status);
}

/** States a seller may resubmit from (re-entering moderation). */
export const RESUBMITTABLE_STATUSES = ["CORRECTION_REQUIRED", "REJECTED"] as const;
