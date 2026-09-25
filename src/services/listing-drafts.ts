import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { getSql, withTransaction } from "@/lib/server/db/client";
import { findActiveCategoryByCode } from "@/repositories/catalog";
import {
  listListingImages,
} from "@/repositories/listing-images";
import {
  createDraftListing,
  getListingFeatureIds,
  getOwnedListing,
  removeIncompatibleListingFeatures,
  replaceListingFeatures,
  updateDraftListing,
  type ListingRow,
} from "@/repositories/listings";
import { findPackageOfType } from "@/repositories/promotions";
import { toOwnerListingDto, type OwnerListingDto } from "@/services/listing-dto";
import { resolveSellerContentPatch } from "@/services/listing-patch";
import { isSellerEditable } from "@/services/listing-states";
import type { DraftPatchInput } from "@/validators/listings";

/**
 * Draft-listing service: ownership scoping, DRAFT-state enforcement,
 * catalog-relationship validation, optimistic revision concurrency,
 * and deterministic dependent-field clearing on category/brand
 * changes. No publication/payment/moderation side effects — a DRAFT
 * stays a DRAFT.
 */

async function loadOwnedListingOrThrow(
  listingId: string,
  ownerId: string,
): Promise<ListingRow> {
  const listing = await getOwnedListing(getSql(), listingId, ownerId);
  if (listing === undefined) {
    // Same answer whether the listing is missing or owned by someone
    // else — no resource-existence leak.
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  return listing;
}

export async function buildOwnerListingDto(
  listing: ListingRow,
): Promise<OwnerListingDto> {
  const sql = getSql();
  const [featureIds, images] = await Promise.all([
    getListingFeatureIds(sql, listing.id),
    listListingImages(sql, listing.id),
  ]);
  return toOwnerListingDto(listing, featureIds, images);
}

export async function createDraft(
  auth: AuthContext,
  categoryCode: string,
): Promise<OwnerListingDto> {
  const category = await findActiveCategoryByCode(categoryCode);
  if (category === undefined) {
    throw new ApiError(
      "LISTING_INVALID_CATALOG_SELECTION",
      "Unknown or inactive category.",
    );
  }
  const listing = await createDraftListing(getSql(), auth.user.id, category.id);
  return buildOwnerListingDto(listing);
}

export async function getOwnedListingDto(
  auth: AuthContext,
  listingId: string,
): Promise<OwnerListingDto> {
  const listing = await loadOwnedListingOrThrow(listingId, auth.user.id);
  return buildOwnerListingDto(listing);
}

function invalidSelection(message: string): ApiError {
  return new ApiError("LISTING_INVALID_CATALOG_SELECTION", message);
}

/** PATCH-key → listing column for the shared content resolution
    (category resolves to category_id; contact_phone normalizes into
    contact_phone_e164; everything else maps 1:1). */
const PATCH_KEY_COLUMNS: Record<string, string> = {
  brand_id: "brand_id",
  model_id: "model_id",
  model_variant_id: "model_variant_id",
  fuel_type_id: "fuel_type_id",
  transmission_id: "transmission_id",
  body_type_id: "body_type_id",
  drive_type_id: "drive_type_id",
  motorcycle_type_id: "motorcycle_type_id",
  color_id: "color_id",
  city_id: "city_id",
  year: "year",
  price_minor: "price_minor",
  mileage: "mileage",
  engine_cc: "engine_cc",
  credit_available: "credit_available",
  barter_available: "barter_available",
  no_accident: "no_accident",
  not_repainted: "not_repainted",
  description: "description",
  contact_phone: "contact_phone_e164",
  seller_name: "seller_name",
};

export async function updateDraft(
  auth: AuthContext,
  listingId: string,
  patch: DraftPatchInput,
): Promise<OwnerListingDto> {
  const listing = await loadOwnedListingOrThrow(listingId, auth.user.id);
  if (!isSellerEditable(listing.status)) {
    throw new ApiError(
      "LISTING_NOT_EDITABLE",
      "The listing is not editable in its current state.",
    );
  }

  // Shared content resolution (identical semantics with the O.12 edit
  // PATCH): catalog validation + dependent clearing in PATCH-key space,
  // mapped to listing columns here.
  const resolved = await resolveSellerContentPatch(
    {
      categoryId: listing.category_id,
      categoryCode: listing.category_code,
      brandId: listing.brand_id,
      modelId: listing.model_id,
    },
    patch,
  );
  const { targetCategoryId, categoryChanged } = resolved;
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resolved.changes)) {
    if (key === "category") {
      set.category_id = targetCategoryId;
      continue;
    }
    set[PATCH_KEY_COLUMNS[key]] = value;
  }
  // Promotion intent preferences: package must exist and match the
  // field's type. is_active is NOT required here (see repository doc);
  // checkout re-resolves an active package server-side regardless.
  if (patch.premium_intent_package_id !== undefined) {
    if (patch.premium_intent_package_id === null) {
      set.premium_intent_package_id = null;
    } else {
      const pkg = await findPackageOfType(getSql(), patch.premium_intent_package_id, "PREMIUM");
      if (pkg === undefined) {
        throw invalidSelection("Unknown PREMIUM promotion package.");
      }
      set.premium_intent_package_id = patch.premium_intent_package_id;
    }
  }
  if (patch.boost_intent_package_id !== undefined) {
    if (patch.boost_intent_package_id === null) {
      set.boost_intent_package_id = null;
    } else {
      const pkg = await findPackageOfType(getSql(), patch.boost_intent_package_id, "BOOST");
      if (pkg === undefined) {
        throw invalidSelection("Unknown BOOST promotion package.");
      }
      set.boost_intent_package_id = patch.boost_intent_package_id;
    }
  }

  const updated = await withTransaction(async (tx) => {
    const applied =
      Object.keys(set).length > 0
        ? await updateDraftListing(tx, {
            listingId,
            ownerId: auth.user.id,
            expectedRevision: patch.expected_revision,
            set,
          })
        : await updateDraftListing(tx, {
            listingId,
            ownerId: auth.user.id,
            expectedRevision: patch.expected_revision,
            set: { status: listing.status }, // no-op column keeps the guarded, revision-bumping update shape
          });
    if (!applied) {
      return false;
    }
    if (patch.feature_ids !== undefined) {
      await replaceListingFeatures(tx, listingId, patch.feature_ids);
    } else if (categoryChanged) {
      await removeIncompatibleListingFeatures(tx, listingId, targetCategoryId);
    }
    return true;
  });

  if (!updated) {
    // Distinguish stale revision from state change without leaking
    // other users' resources (ownership was already proven above).
    const current = await loadOwnedListingOrThrow(listingId, auth.user.id);
    if (!isSellerEditable(current.status)) {
      throw new ApiError(
        "LISTING_NOT_EDITABLE",
        "The listing is not editable in its current state.",
      );
    }
    throw new ApiError(
      "LISTING_REVISION_CONFLICT",
      "The draft was modified by another request. Reload and retry.",
      { details: { current_revision: current.revision } },
    );
  }

  const fresh = await loadOwnedListingOrThrow(listingId, auth.user.id);
  return buildOwnerListingDto(fresh);
}
