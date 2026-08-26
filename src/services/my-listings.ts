import type { AuthContext } from "@/auth/current-user";
import { listingImageConfig } from "@/lib/config/listing-images";
import { getSql } from "@/lib/server/db/client";
import { getStorageProvider } from "@/providers/storage/factory";
import {
  findInitialPaidIntent,
  findLatestReviewForListing,
  listOwnerListings,
  type OwnerCardRow,
} from "@/repositories/my-listings";
import { RESUBMITTABLE_STATUSES } from "@/services/listing-states";

/**
 * Seller-facing "My Listings" read model + the seller-safe moderation
 * feedback projection. Feedback exposes ONLY decision, controlled
 * reason code, plain-text note, and time — never moderator identity,
 * claims, or internal review ids — and only while the listing is
 * actually sitting in a moderator-returned state.
 */

export const MY_LISTINGS_FILTERS = {
  all: null,
  active: ["ACTIVE"],
  moderation: ["PENDING_MODERATION"],
  draft: ["DRAFT"],
  correction: ["CORRECTION_REQUIRED", "REJECTED"],
} as const;

export type MyListingsFilter = keyof typeof MY_LISTINGS_FILTERS;

export interface SellerModerationFeedbackDto {
  decision: string;
  reasonCode: string | null;
  note: string | null;
  reviewedAt: string;
}

export interface OwnerCardDto {
  id: string;
  publicId: string;
  status: string;
  revision: number;
  category: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  priceMinor: number | null;
  currency: string;
  mileage: number | null;
  city: string | null;
  imageCount: number;
  primaryImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  publishedAt: string | null;
  currentExpiresAt: string | null;
  premiumUntil: string | null;
  boostUntil: string | null;
  moderationFeedback: SellerModerationFeedbackDto | null;
}

function feedbackVisible(status: string): boolean {
  return (RESUBMITTABLE_STATUSES as readonly string[]).includes(status);
}

async function signOwnerImage(path: string | null): Promise<string | null> {
  if (path === null) {
    return null;
  }
  const config = listingImageConfig();
  return getStorageProvider()
    .createSignedReadUrl(config.imagesBucket, path, config.signedReadTtlSeconds)
    .catch(() => null);
}

async function toCardDto(row: OwnerCardRow): Promise<OwnerCardDto> {
  const feedback =
    feedbackVisible(row.status) && row.review_decision !== null
      ? {
          decision: row.review_decision,
          reasonCode: row.review_reason_code,
          note: row.review_note,
          reviewedAt: row.review_reviewed_at!.toISOString(),
        }
      : null;
  return {
    id: row.id,
    publicId: row.public_id,
    status: row.status,
    revision: row.revision,
    category: row.category,
    brand: row.brand,
    model: row.model,
    year: row.year,
    priceMinor: row.price_minor === null ? null : Number(row.price_minor),
    currency: row.currency,
    mileage: row.mileage,
    city: row.city,
    imageCount: row.image_count,
    primaryImageUrl: await signOwnerImage(row.primary_image_path),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    submittedAt: row.submitted_at?.toISOString() ?? null,
    publishedAt: row.published_at?.toISOString() ?? null,
    currentExpiresAt: row.current_expires_at?.toISOString() ?? null,
    premiumUntil: row.premium_until?.toISOString() ?? null,
    boostUntil: row.boost_until?.toISOString() ?? null,
    moderationFeedback: feedback,
  };
}

export async function myListings(
  auth: AuthContext,
  filter: MyListingsFilter,
): Promise<OwnerCardDto[]> {
  const rows = await listOwnerListings(
    getSql(),
    auth.user.id,
    MY_LISTINGS_FILTERS[filter] === null ? null : [...MY_LISTINGS_FILTERS[filter]!],
  );
  return Promise.all(rows.map(toCardDto));
}

/**
 * Seller-safe feedback for one listing the caller has ALREADY
 * verified as owned (the detail route loads the owner DTO first, so
 * foreign/missing listings 404 before this runs).
 */
export async function sellerFeedbackFor(
  listingId: string,
  status: string,
): Promise<SellerModerationFeedbackDto | null> {
  if (!feedbackVisible(status)) {
    return null;
  }
  const review = await findLatestReviewForListing(getSql(), listingId);
  if (review === undefined) {
    return null;
  }
  return {
    decision: review.decision,
    reasonCode: review.reason_code,
    note: review.note,
    reviewedAt: review.reviewed_at.toISOString(),
  };
}

export interface PaymentRequiredDto {
  type: string;
  amountMinor: number;
  currency: string;
  status: string;
}

/**
 * Owner-safe snapshot of the pending LISTING_FEE intent for a
 * PAYMENT_REQUIRED listing the caller has ALREADY verified as owned.
 * Once the intent exists, ITS amount/currency/status are the
 * authority for this listing's debt — later publication-fee setting
 * changes must never alter what the seller owes. If the intent is
 * missing (inconsistent data), this returns null and the UI shows no
 * amount — it never falls back to current settings as if they were
 * the debt. No payment UUID, provider, or idempotency internals leave
 * the server.
 */
export async function paymentRequiredFor(
  listingId: string,
  ownerId: string,
  status: string,
): Promise<PaymentRequiredDto | null> {
  if (status !== "PAYMENT_REQUIRED") {
    return null;
  }
  const intent = await findInitialPaidIntent(getSql(), listingId, ownerId);
  if (intent === undefined) {
    return null;
  }
  return {
    type: intent.type,
    amountMinor: Number(intent.amount_minor),
    currency: intent.currency,
    status: intent.status,
  };
}
