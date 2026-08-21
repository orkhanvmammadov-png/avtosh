import type { AuthContext } from "@/auth/current-user";
import { normalizePhoneE164 } from "@/auth/phone";
import { ApiError } from "@/lib/api/errors";
import { getSql, withTransaction } from "@/lib/server/db/client";
import {
  findActiveBrandInCategory,
  findActiveCategoryByCode,
  findActiveCityById,
  findActiveModelInBrandCategory,
  findActiveReferenceOptionForCategory,
  filterActiveFeatureIdsForCategory,
} from "@/repositories/catalog";
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
import { toOwnerListingDto, type OwnerListingDto } from "@/services/listing-dto";
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

interface ReferenceFieldSpec {
  patchKey: keyof DraftPatchInput;
  column: string;
  group: string;
}

const REFERENCE_FIELDS: ReferenceFieldSpec[] = [
  { patchKey: "fuel_type_id", column: "fuel_type_id", group: "FUEL_TYPE" },
  { patchKey: "transmission_id", column: "transmission_id", group: "TRANSMISSION" },
  { patchKey: "body_type_id", column: "body_type_id", group: "BODY_TYPE" },
  { patchKey: "drive_type_id", column: "drive_type_id", group: "DRIVE_TYPE" },
  {
    patchKey: "motorcycle_type_id",
    column: "motorcycle_type_id",
    group: "MOTORCYCLE_TYPE",
  },
  { patchKey: "color_id", column: "color_id", group: "COLOR" },
];

function invalidSelection(message: string): ApiError {
  return new ApiError("LISTING_INVALID_CATALOG_SELECTION", message);
}

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

  // Resolve the target category (it may change on a draft). Changing
  // it deterministically clears dependent fields server-side (brand,
  // model, category-scoped option selections, incompatible features)
  // unless the same request supplies valid replacements.
  let targetCategoryId = listing.category_id;
  const set: Record<string, unknown> = {};
  let categoryChanged = false;
  if (patch.category !== undefined && patch.category !== listing.category_code) {
    const category = await findActiveCategoryByCode(patch.category);
    if (category === undefined) {
      throw invalidSelection("Unknown or inactive category.");
    }
    targetCategoryId = category.id;
    categoryChanged = true;
    set.category_id = category.id;
    set.brand_id = null;
    set.model_id = null;
    set.body_type_id = null;
    set.motorcycle_type_id = null;
  }

  // Brand: validate against the target category.
  let effectiveBrandId = categoryChanged ? null : listing.brand_id;
  if (patch.brand_id !== undefined) {
    if (patch.brand_id === null) {
      set.brand_id = null;
      set.model_id = null;
      effectiveBrandId = null;
    } else {
      const brand = await findActiveBrandInCategory(
        patch.brand_id,
        targetCategoryId,
      );
      if (brand === undefined) {
        throw invalidSelection(
          "Brand is unknown, inactive, or not available in the category.",
        );
      }
      if (patch.brand_id !== listing.brand_id) {
        // Brand change invalidates the previously chosen model.
        set.model_id = null;
      }
      set.brand_id = patch.brand_id;
      effectiveBrandId = patch.brand_id;
    }
  }

  // Model: requires a valid effective brand in the target category.
  if (patch.model_id !== undefined) {
    if (patch.model_id === null) {
      set.model_id = null;
    } else {
      if (effectiveBrandId === null) {
        throw invalidSelection("A brand must be selected before a model.");
      }
      const model = await findActiveModelInBrandCategory(
        patch.model_id,
        effectiveBrandId,
        targetCategoryId,
      );
      if (model === undefined) {
        throw invalidSelection(
          "Model is unknown, inactive, or does not belong to the brand and category.",
        );
      }
      set.model_id = patch.model_id;
    }
  }

  for (const field of REFERENCE_FIELDS) {
    const value = patch[field.patchKey];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      set[field.column] = null;
      continue;
    }
    const option = await findActiveReferenceOptionForCategory(
      value as string,
      field.group,
      targetCategoryId,
    );
    if (option === undefined) {
      throw invalidSelection(
        `Invalid ${field.group} selection for this category.`,
      );
    }
    set[field.column] = value;
  }

  if (patch.city_id !== undefined) {
    if (patch.city_id === null) {
      set.city_id = null;
    } else {
      const city = await findActiveCityById(patch.city_id);
      if (city === undefined) {
        throw invalidSelection("Unknown or inactive city.");
      }
      set.city_id = patch.city_id;
    }
  }

  if (patch.feature_ids !== undefined && patch.feature_ids.length > 0) {
    const valid = await filterActiveFeatureIdsForCategory(
      patch.feature_ids,
      targetCategoryId,
    );
    if (valid.length !== patch.feature_ids.length) {
      throw invalidSelection(
        "One or more features are unknown, inactive, or not valid for this category.",
      );
    }
  }

  if (patch.year !== undefined) set.year = patch.year;
  if (patch.price_minor !== undefined) set.price_minor = patch.price_minor;
  if (patch.mileage !== undefined) set.mileage = patch.mileage;
  if (patch.engine_cc !== undefined) set.engine_cc = patch.engine_cc;
  if (patch.credit_available !== undefined)
    set.credit_available = patch.credit_available;
  if (patch.barter_available !== undefined)
    set.barter_available = patch.barter_available;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.contact_phone !== undefined) {
    if (patch.contact_phone === null) {
      set.contact_phone_e164 = null;
    } else {
      const normalized = normalizePhoneE164(patch.contact_phone);
      if (normalized === null) {
        throw new ApiError("VALIDATION_ERROR", "Invalid contact phone number.", {
          details: [{ parameter: "contact_phone", message: "Invalid phone number" }],
        });
      }
      set.contact_phone_e164 = normalized;
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
