import { normalizePhoneE164 } from "@/auth/phone";
import { ApiError } from "@/lib/api/errors";
import {
  findActiveBrandInCategory,
  findActiveCategoryByCode,
  findActiveCityById,
  findActiveModelInBrandCategory,
  findActiveReferenceOptionForCategory,
  filterActiveFeatureIdsForCategory,
} from "@/repositories/catalog";
import type { EditPatchInput } from "@/validators/listings";

/**
 * ONE seller content-patch resolution shared by the draft PATCH and
 * the O.12 edit-revision PATCH — identical catalog-relationship
 * validation, deterministic dependent-field clearing on category/brand
 * changes, and identical normalization (E.164 contact phone, trimmed
 * seller name). Output stays in PATCH-key space; each caller maps it
 * to its own persistence target (listing columns vs revision.data).
 */

export interface SellerPatchContext {
  categoryId: string;
  categoryCode: string;
  brandId: string | null;
}

export interface ResolvedSellerPatch {
  /** Validated/normalized changes in PATCH-key space (only supplied or
      dependently-cleared keys present; feature_ids excluded). */
  changes: Record<string, unknown>;
  targetCategoryId: string;
  categoryChanged: boolean;
}

interface ReferenceFieldSpec {
  patchKey: keyof EditPatchInput;
  group: string;
}

const REFERENCE_FIELDS: ReferenceFieldSpec[] = [
  { patchKey: "fuel_type_id", group: "FUEL_TYPE" },
  { patchKey: "transmission_id", group: "TRANSMISSION" },
  { patchKey: "body_type_id", group: "BODY_TYPE" },
  { patchKey: "drive_type_id", group: "DRIVE_TYPE" },
  { patchKey: "motorcycle_type_id", group: "MOTORCYCLE_TYPE" },
  { patchKey: "color_id", group: "COLOR" },
];

function invalidSelection(message: string): ApiError {
  return new ApiError("LISTING_INVALID_CATALOG_SELECTION", message);
}

export async function resolveSellerContentPatch(
  current: SellerPatchContext,
  patch: EditPatchInput,
): Promise<ResolvedSellerPatch> {
  // Resolve the target category (it may change). Changing it
  // deterministically clears dependent fields server-side (brand,
  // model, category-scoped option selections; the caller prunes
  // incompatible features) unless the same request supplies valid
  // replacements.
  let targetCategoryId = current.categoryId;
  const changes: Record<string, unknown> = {};
  let categoryChanged = false;
  if (patch.category !== undefined && patch.category !== current.categoryCode) {
    const category = await findActiveCategoryByCode(patch.category);
    if (category === undefined) {
      throw invalidSelection("Unknown or inactive category.");
    }
    targetCategoryId = category.id;
    categoryChanged = true;
    changes.category = patch.category;
    changes.brand_id = null;
    changes.model_id = null;
    changes.body_type_id = null;
    changes.motorcycle_type_id = null;
  }

  // Brand: validate against the target category.
  let effectiveBrandId = categoryChanged ? null : current.brandId;
  if (patch.brand_id !== undefined) {
    if (patch.brand_id === null) {
      changes.brand_id = null;
      changes.model_id = null;
      effectiveBrandId = null;
    } else {
      const brand = await findActiveBrandInCategory(patch.brand_id, targetCategoryId);
      if (brand === undefined) {
        throw invalidSelection(
          "Brand is unknown, inactive, or not available in the category.",
        );
      }
      if (patch.brand_id !== current.brandId) {
        // Brand change invalidates the previously chosen model.
        changes.model_id = null;
      }
      changes.brand_id = patch.brand_id;
      effectiveBrandId = patch.brand_id;
    }
  }

  // Model: requires a valid effective brand in the target category.
  if (patch.model_id !== undefined) {
    if (patch.model_id === null) {
      changes.model_id = null;
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
      changes.model_id = patch.model_id;
    }
  }

  for (const field of REFERENCE_FIELDS) {
    const value = patch[field.patchKey];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      changes[field.patchKey] = null;
      continue;
    }
    const option = await findActiveReferenceOptionForCategory(
      value as string,
      field.group,
      targetCategoryId,
    );
    if (option === undefined) {
      throw invalidSelection(`Invalid ${field.group} selection for this category.`);
    }
    changes[field.patchKey] = value;
  }

  if (patch.city_id !== undefined) {
    if (patch.city_id === null) {
      changes.city_id = null;
    } else {
      const city = await findActiveCityById(patch.city_id);
      if (city === undefined) {
        throw invalidSelection("Unknown or inactive city.");
      }
      changes.city_id = patch.city_id;
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

  if (patch.year !== undefined) changes.year = patch.year;
  if (patch.price_minor !== undefined) changes.price_minor = patch.price_minor;
  if (patch.mileage !== undefined) changes.mileage = patch.mileage;
  if (patch.engine_cc !== undefined) changes.engine_cc = patch.engine_cc;
  if (patch.credit_available !== undefined)
    changes.credit_available = patch.credit_available;
  if (patch.barter_available !== undefined)
    changes.barter_available = patch.barter_available;
  if (patch.no_accident !== undefined) changes.no_accident = patch.no_accident;
  if (patch.not_repainted !== undefined) changes.not_repainted = patch.not_repainted;
  if (patch.description !== undefined) changes.description = patch.description;
  if (patch.contact_phone !== undefined) {
    if (patch.contact_phone === null) {
      changes.contact_phone = null;
    } else {
      const normalized = normalizePhoneE164(patch.contact_phone);
      if (normalized === null) {
        throw new ApiError("VALIDATION_ERROR", "Invalid contact phone number.", {
          details: [{ parameter: "contact_phone", message: "Invalid phone number" }],
        });
      }
      changes.contact_phone = normalized;
    }
  }
  if (patch.seller_name !== undefined) {
    // Listing-level public seller name only — users.display_name is
    // never mutated from the seller flow.
    const trimmed = patch.seller_name?.trim() ?? "";
    changes.seller_name = trimmed === "" ? null : trimmed;
  }

  return { changes, targetCategoryId, categoryChanged };
}
