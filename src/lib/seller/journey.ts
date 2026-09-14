import type { OwnerListingDto } from "@/services/listing-dto";

/**
 * O.10 journey model (flow.md — SEALED, exactly 6 stages) and the
 * PURE entry-derivation helpers (audit-dependent.md items 2 & 3).
 * Journey position is intentionally frontend UI state: nothing here
 * reads or writes persistence beyond the already-loaded owner DTO.
 */

export const STAGES = ["quickstart", "details", "sale", "photos", "infoContact", "review"] as const;
export type StageKey = (typeof STAGES)[number];
export const STAGE_COUNT = STAGES.length;

/**
 * Deterministic DRAFT resume (final O.10 hierarchy):
 *  A. Quick-Start identity incomplete            → quickstart
 *  B. fresh post-Quick-Start draft (no meaningful
 *     data beyond identity)                      → details
 *  C. first required gate not ready, in order
 *     sale → photos → infoContact                → that stage
 *  D. every required gate ready                  → review
 *
 * ACCEPTED LIMITATION (Case F): a manual backward UI position before
 * closing the browser is NOT persisted anywhere and therefore not
 * recoverable — reopening derives from data alone. Likewise a
 * trailing visit to an all-optional stage that stored nothing is
 * indistinguishable from never visiting it; the conservative resume
 * (reopen it) is harmless under the strict sequential flow.
 */
export function deriveResumeStage(dto: OwnerListingDto): StageKey {
  const identity = dto.brandId !== null && dto.modelId !== null && dto.year !== null;
  if (!identity) return "quickstart";
  const saleData = dto.priceMinor !== null || dto.mileage !== null || dto.cityId !== null;
  const saleValid = dto.priceMinor !== null && dto.mileage !== null && dto.cityId !== null;
  const photosData = dto.images.length > 0;
  const extrasData = dto.featureIds.length > 0 || dto.description !== null;
  const contactData = dto.sellerName !== null || dto.contactPhone !== null;
  const contactValid = dto.sellerName !== null && dto.contactPhone !== null;
  if (!saleData && !photosData && !extrasData && !contactData) return "details"; // fresh draft
  if (!saleValid) return "sale";
  if (dto.images.length < 3) return "photos";
  if (!contactValid) return "infoContact";
  return "review";
}

/**
 * Correction/resubmit entry (audit-approved honest mapping): only the
 * four reason codes with real stage precision deep-link; everything
 * else — including null/unknown codes — falls back to Review, where
 * the banner plus Dəyiş lets the seller choose the section manually.
 * Frontend-only; server enum semantics untouched.
 */
const REASON_STAGE: Record<string, StageKey | null> = {
  INVALID_PHOTOS: "photos",
  SUSPICIOUS_PRICE: "sale",
  CONTACT_ISSUE: "infoContact",
  WRONG_CATEGORY: "quickstart",
  MISLEADING_INFO: null,
  INCOMPLETE_INFO: null,
  DUPLICATE_LISTING: null,
  PROHIBITED_ITEM: null,
  OTHER: null,
};

export function correctionEntryStage(reasonCode: string | null): StageKey {
  if (reasonCode === null) return "review";
  return REASON_STAGE[reasonCode] ?? "review";
}
