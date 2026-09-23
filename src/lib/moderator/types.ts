import type { EditReviewDto } from "@/services/moderation-edit";
import type { ModerationFeatureGroupDto } from "@/services/moderation-content";
import type { AdjustmentDto } from "@/services/moderation-adjustments";

/** Typed view of the moderation detail DTO (service returns a plain record). */
export interface ModerationDetailView {
  /** O.13 Stage B: the OPEN private moderator adjustment, or null. */
  adjustment: AdjustmentDto | null;
  /** O.13 Stage B: edit-mode base for the current moderation subject. */
  adjustmentContext: {
    subject: {
      type: "NEW_LISTING" | "LISTING_EDIT";
      listingRevision: number;
      editRevisionId: string | null;
      editRevisionNo: number | null;
    };
    baseContent: Record<string, unknown>;
    imageMin: number;
  } | null;
  /** O.13 Stage B: append-only adjustment save/discard history. */
  adjustmentEvents: { action: string; actorName: string | null; at: string }[];
  /** O.13 Stage A: full grouped equipment of the listing content. */
  featureGroups: ModerationFeatureGroupDto[];
  /** O.12: pending edit-revision comparison, or null. */
  editReview: EditReviewDto | null;
  id: string;
  publicId: string;
  status: string;
  revision: number;
  category: string;
  brand: { id: string; name: string } | null;
  model: { id: string; name: string } | null;
  year: number | null;
  priceMinor: number | null;
  currency: string;
  mileage: number | null;
  engineCc: number | null;
  fuelType: string | null;
  transmission: string | null;
  bodyType: string | null;
  driveType: string | null;
  motorcycleType: string | null;
  color: string | null;
  cityName: string | null;
  creditAvailable: boolean;
  noAccident: boolean | null;
  notRepainted: boolean | null;
  barterAvailable: boolean;
  description: string | null;
  contactPhone: string | null;
  sellerName: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  currentExpiresAt: string | null;
  seller: { id: string; phoneMasked: string; displayName: string | null; status: string };
  images: { id: string; sortOrder: number; isPrimary: boolean; url: string | null }[];
  reviews: {
    id: string;
    decision: "APPROVED" | "REJECTED" | "CORRECTION_REQUESTED";
    reasonCode: string | null;
    note: string | null;
    reviewedAt: string;
  }[];
  claim: { moderatorId: string; expiresAt: string } | null;
}
