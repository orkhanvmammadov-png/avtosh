import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { getSql, withTransaction, type Sql } from "@/lib/server/db/client";
import {
  findActiveBrandInCategory,
  findActiveCategoryByCode,
  findActiveCityById,
  findActiveModelInBrandCategory,
  findActiveReferenceOptionForCategory,
  filterActiveFeatureIdsForCategory,
} from "@/repositories/catalog";
import { countListingImages } from "@/repositories/listing-images";
import {
  countPrimaryImages,
  countPublications,
  expirePendingUploadsForListing,
  getPaymentById,
  getPublicationByListing,
  getSubmissionSettings,
  insertListingFeeIntent,
  insertOutboxEvent,
  insertPublication,
  insertStatusHistory,
  lockUserRow,
  nextPublicationNumber,
  transitionListingFromDraft,
  type PaymentRow,
  type PublicationRow,
  type SubmissionSettings,
} from "@/repositories/listing-publications";
import {
  getListingFeatureIds,
  getOwnedListingRowForUpdate,
  type ListingRow,
} from "@/repositories/listings";
import { resubmitListing as resubmitListingRow } from "@/repositories/moderation";
import { RESUBMITTABLE_STATUSES } from "@/services/listing-states";

/**
 * Initial submission & lifetime publication allocation.
 *
 * Lock order (documented to prevent deadlocks): users row → listings
 * row. Image/draft flows lock only the listing row, so no cycle.
 *
 * Inside ONE transaction: lock user → lock listing → idempotent
 * short-circuit if a publication already exists → DRAFT + revision
 * check → completeness + catalog revalidation → ordinal =
 * MAX(publication_number)+1 (serialized by the user lock; the UNIQUE
 * constraints are defense in depth) → FREE (≤ limit) or PAID (internal
 * LISTING_FEE intent, no provider) → status transition → pending
 * uploads invalidated → status history → outbox. No network calls.
 * Submission does NOT increment the content revision (pure state
 * transition; the content is unchanged and frozen afterwards).
 */

export interface ListingQuotaDto {
  freeLimit: number;
  lifetimePublications: number;
  freeUsed: number;
  freeRemaining: number;
  nextPublicationNumber: number;
  nextPublicationIsPaid: boolean;
  listingFeeMinor: number;
  currency: "AZN";
}

export interface SubmissionResultDto {
  listing: { id: string; status: string; revision: number };
  publication: { number: number; billingType: "FREE" | "PAID" };
  payment: {
    id: string;
    type: string;
    amountMinor: number;
    currency: string;
    status: string;
  } | null;
  nextAction: "MODERATION" | "PAYMENT";
}

const REQUIRED_FIELDS: { key: keyof ListingRow; code: string }[] = [
  { key: "brand_id", code: "brand" },
  { key: "model_id", code: "model" },
  { key: "year", code: "year" },
  { key: "price_minor", code: "price" },
  { key: "mileage", code: "mileage" },
  { key: "city_id", code: "city" },
  { key: "contact_phone_e164", code: "contact_phone" },
];

const REFERENCE_COLUMNS: { key: keyof ListingRow; group: string }[] = [
  { key: "fuel_type_id", group: "FUEL_TYPE" },
  { key: "transmission_id", group: "TRANSMISSION" },
  { key: "body_type_id", group: "BODY_TYPE" },
  { key: "drive_type_id", group: "DRIVE_TYPE" },
  { key: "motorcycle_type_id", group: "MOTORCYCLE_TYPE" },
  { key: "color_id", group: "COLOR" },
];

async function requireSettings(sql: Sql): Promise<SubmissionSettings> {
  const settings = await getSubmissionSettings(sql);
  if (settings === null) {
    throw new ApiError(
      "LISTING_PAYMENT_CONFIGURATION_ERROR",
      "Listing publication settings are not configured.",
    );
  }
  return settings;
}

export async function getListingQuota(
  auth: AuthContext,
): Promise<ListingQuotaDto> {
  const sql = getSql();
  const settings = await requireSettings(sql);
  const lifetime = await countPublications(sql, auth.user.id);
  const freeUsed = Math.min(lifetime, settings.freeLimit);
  const next = lifetime + 1;
  return {
    freeLimit: settings.freeLimit,
    lifetimePublications: lifetime,
    freeUsed,
    freeRemaining: settings.freeLimit - freeUsed,
    nextPublicationNumber: next,
    nextPublicationIsPaid: next > settings.freeLimit,
    listingFeeMinor: settings.feeMinor,
    currency: "AZN",
  };
}

function toResult(
  listing: { id: string; status: string; revision: number },
  publication: PublicationRow,
  payment: PaymentRow | null,
): SubmissionResultDto {
  return {
    listing,
    publication: {
      number: publication.publication_number,
      billingType: publication.billing_type,
    },
    payment:
      payment === null
        ? null
        : {
            id: payment.id,
            type: payment.type,
            amountMinor: Number(payment.amount_minor),
            currency: payment.currency,
            status: payment.status,
          },
    nextAction: publication.billing_type === "FREE" ? "MODERATION" : "PAYMENT",
  };
}

async function assertComplete(
  tx: Sql,
  listing: ListingRow,
  imageMin: number,
): Promise<void> {
  const missing = REQUIRED_FIELDS.filter((f) => listing[f.key] === null).map(
    (f) => f.code,
  );
  if (missing.length > 0) {
    throw new ApiError("LISTING_INCOMPLETE", "The listing is incomplete.", {
      details: { missing },
    });
  }
  // Only processed listing_images count — never pending uploads.
  const confirmed = await countListingImages(tx, listing.id);
  if (confirmed < imageMin) {
    throw new ApiError(
      "LISTING_INSUFFICIENT_IMAGES",
      `At least ${imageMin} images are required.`,
      { details: { required: imageMin, confirmed } },
    );
  }
  if ((await countPrimaryImages(tx, listing.id)) !== 1) {
    throw new ApiError("LISTING_INSUFFICIENT_IMAGES", "A primary image is required.", {
      details: { required: imageMin, confirmed, primary: false },
    });
  }
}

/** Revalidates persisted catalog references against CURRENT active data. */
async function revalidateCatalog(tx: Sql, listing: ListingRow): Promise<void> {
  const invalid = (field: string): ApiError =>
    new ApiError(
      "LISTING_INVALID_CATALOG_SELECTION",
      "A selected catalog value is no longer valid.",
      { details: { field } },
    );
  const category = await findActiveCategoryByCode(listing.category_code);
  if (category === undefined) throw invalid("category");
  const brand = await findActiveBrandInCategory(listing.brand_id!, category.id);
  if (brand === undefined) throw invalid("brand");
  const model = await findActiveModelInBrandCategory(
    listing.model_id!,
    listing.brand_id!,
    category.id,
  );
  if (model === undefined) throw invalid("model");
  const city = await findActiveCityById(listing.city_id!);
  if (city === undefined) throw invalid("city");
  for (const ref of REFERENCE_COLUMNS) {
    const value = listing[ref.key];
    if (value === null) continue;
    const option = await findActiveReferenceOptionForCategory(
      value as string,
      ref.group,
      category.id,
    );
    if (option === undefined) throw invalid(ref.group.toLowerCase());
  }
  const featureIds = await getListingFeatureIds(tx, listing.id);
  if (featureIds.length > 0) {
    const valid = await filterActiveFeatureIdsForCategory(featureIds, category.id);
    if (valid.length !== featureIds.length) throw invalid("features");
  }
}

export async function submitListing(
  auth: AuthContext,
  listingId: string,
  expectedRevision: number,
): Promise<SubmissionResultDto> {
  return withTransaction(async (tx) => {
    const settings = await requireSettings(tx);
    await lockUserRow(tx, auth.user.id);
    const listing = await getOwnedListingRowForUpdate(tx, listingId, auth.user.id);
    if (listing === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }

    // Idempotent retry: the initial submission already completed.
    const existing = await getPublicationByListing(tx, listingId);
    if (existing !== undefined) {
      const payment =
        existing.payment_id === null
          ? null
          : ((await getPaymentById(tx, existing.payment_id)) ?? null);
      return toResult(
        { id: listing.id, status: listing.status, revision: listing.revision },
        existing,
        payment,
      );
    }

    if (listing.status !== "DRAFT") {
      throw new ApiError("LISTING_NOT_EDITABLE", "Only draft listings can be submitted.");
    }
    if (listing.revision !== expectedRevision) {
      throw new ApiError(
        "LISTING_REVISION_CONFLICT",
        "The draft was modified by another request. Reload and retry.",
        { details: { current_revision: listing.revision } },
      );
    }

    await assertComplete(tx, listing, settings.imageMin);
    await revalidateCatalog(tx, listing);

    // Allocation — serialized by the user row lock.
    const number = await nextPublicationNumber(tx, auth.user.id);
    const isFree = number <= settings.freeLimit;

    let payment: PaymentRow | null = null;
    if (!isFree) {
      payment = await insertListingFeeIntent(tx, {
        userId: auth.user.id,
        listingId,
        amountMinor: settings.feeMinor,
        idempotencyKey: `listing_fee:initial:${listingId}`,
      });
    }
    const publication = await insertPublication(tx, {
      listingId,
      userId: auth.user.id,
      publicationNumber: number,
      billingType: isFree ? "FREE" : "PAID",
      paymentId: payment?.id ?? null,
    });

    const toStatus = isFree ? "PENDING_MODERATION" : "PAYMENT_REQUIRED";
    const transitioned = await transitionListingFromDraft(tx, {
      listingId,
      toStatus,
      expectedRevision,
      setSubmittedAt: isFree, // submitted_at = moderation-queue entry
    });
    if (!transitioned) {
      throw new ApiError("LISTING_REVISION_CONFLICT", "The draft changed during submission.");
    }
    await expirePendingUploadsForListing(tx, listingId);
    await insertStatusHistory(tx, {
      listingId,
      fromStatus: "DRAFT",
      toStatus,
      actorUserId: auth.user.id,
      reasonCode: "INITIAL_SUBMISSION",
    });
    await insertOutboxEvent(tx, {
      eventType: isFree ? "LISTING_ENTERED_MODERATION" : "LISTING_PAYMENT_REQUIRED",
      aggregateId: listingId,
      payload: {
        listing_id: listingId,
        user_id: auth.user.id,
        publication_number: number,
        billing_type: isFree ? "FREE" : "PAID",
        payment_id: payment?.id ?? null,
      },
    });

    return toResult(
      { id: listing.id, status: toStatus, revision: listing.revision },
      publication,
      payment,
    );
  });
}

export interface ResubmissionResultDto {
  listing: { id: string; status: string; revision: number };
  publication: { number: number; billingType: "FREE" | "PAID" };
  nextAction: "MODERATION";
}

/**
 * Seller resubmission after CORRECTION_REQUIRED / REJECTED. Re-enters
 * the moderation queue with a fresh submitted_at. NO new publication
 * row, ordinal, or LISTING_FEE payment — the existing initial
 * publication (free or already paid) remains authoritative, so a
 * future paid listing that reaches moderation resubmits identically.
 * Idempotent: a retry that finds the listing already PENDING_MODERATION
 * at the same revision returns the same result without new effects.
 */
export async function resubmitListing(
  auth: AuthContext,
  listingId: string,
  expectedRevision: number,
): Promise<ResubmissionResultDto> {
  return withTransaction(async (tx) => {
    const settings = await requireSettings(tx);
    const listing = await getOwnedListingRowForUpdate(tx, listingId, auth.user.id);
    if (listing === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    const publication = await getPublicationByListing(tx, listingId);
    if (publication === undefined) {
      throw new ApiError("LISTING_NOT_EDITABLE", "The listing was never submitted.");
    }
    const result = (): ResubmissionResultDto => ({
      listing: { id: listing.id, status: "PENDING_MODERATION", revision: listing.revision },
      publication: { number: publication.publication_number, billingType: publication.billing_type },
      nextAction: "MODERATION",
    });
    if (listing.status === "PENDING_MODERATION" && listing.revision === expectedRevision) {
      return result(); // idempotent retry
    }
    if (!(RESUBMITTABLE_STATUSES as readonly string[]).includes(listing.status)) {
      throw new ApiError("LISTING_NOT_EDITABLE", "The listing cannot be resubmitted from its current state.");
    }
    if (listing.revision !== expectedRevision) {
      throw new ApiError(
        "LISTING_REVISION_CONFLICT",
        "The listing was modified by another request. Reload and retry.",
        { details: { current_revision: listing.revision } },
      );
    }
    await assertComplete(tx, listing, settings.imageMin);
    await revalidateCatalog(tx, listing);
    const ok = await resubmitListingRow(tx, {
      listingId,
      expectedRevision,
      fromStatuses: RESUBMITTABLE_STATUSES,
    });
    if (!ok) {
      throw new ApiError("LISTING_REVISION_CONFLICT", "The listing changed during resubmission.");
    }
    await expirePendingUploadsForListing(tx, listingId);
    await insertStatusHistory(tx, {
      listingId,
      fromStatus: listing.status,
      toStatus: "PENDING_MODERATION",
      actorUserId: auth.user.id,
      reasonCode: "RESUBMISSION",
    });
    await insertOutboxEvent(tx, {
      eventType: "LISTING_ENTERED_MODERATION",
      aggregateId: listingId,
      payload: {
        listing_id: listingId,
        user_id: auth.user.id,
        publication_number: publication.publication_number,
        billing_type: publication.billing_type,
        resubmission: true,
      },
    });
    return result();
  });
}
