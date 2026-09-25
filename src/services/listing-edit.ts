import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { getSql, withTransaction, type Sql } from "@/lib/server/db/client";
import {
  findActiveBrandInCategory,
  findActiveCategoryByCode,
  findActiveCityById,
  findActiveModelInBrandCategory,
  findActiveVariantInModel,
  modelHasActiveVariants,
  findActiveReferenceOptionForCategory,
  filterActiveFeatureIdsForCategory,
} from "@/repositories/catalog";
import {
  countEditImages,
  countPrimaryEditImages,
} from "@/repositories/listing-edit-images";
import {
  getOpenEditRevision,
  listEditRevisionImages,
  lockOpenEditRevision,
  submitEditRevisionRow,
  updateEditRevisionData,
  type EditImageRow,
  type EditRevisionRow,
} from "@/repositories/listing-edit-revisions";
import {
  getOwnedListingForLifecycle,
  lockOwnedListingForLifecycle,
  recordReactivationRequest,
  type LifecycleListingRow,
} from "@/repositories/listing-lifecycle";
import {
  expirePendingUploadsForListing,
  getSubmissionSettings,
  insertOutboxEvent,
} from "@/repositories/listing-publications";
import { insertSellerAudit } from "@/repositories/seller-audit";
import { getOrCreateEditRevision } from "@/services/listing-lifecycle";
import { toListingImageDto, type OwnerListingDto } from "@/services/listing-dto";
import { resolveSellerContentPatch } from "@/services/listing-patch";
import { deriveOwnerManagement, type OwnerManagement } from "@/lib/seller/management";
import type { EditPatchInput } from "@/validators/listings";

/**
 * O.12 Stage C — revision-backed seller editing. The editor UI speaks
 * the SAME OwnerListingDto contract as the NEW-listing flow; here that
 * shape is materialized from listing_edit_revisions.data + the staged
 * gallery, with `revision` carrying the EDIT revision's own counter.
 * The approved listing row, listing_images and listing_features are
 * NEVER written from this module — public content changes only through
 * a future moderator approval (Stage D).
 */

/** Edit-scoped lifecycle context the UI renders around the wizard. */
export interface EditContextDto {
  editRevisionId: string;
  editStatus: string;
  editSubmittedAt: string | null;
  listingStatus: string;
  effectiveExpired: boolean;
  sellerDeactivated: boolean;
  reactivationRequested: boolean;
  management: OwnerManagement;
  moderationFeedback: { reasonCode: string | null; note: string | null } | null;
}

export interface OwnerEditView {
  listing: OwnerListingDto;
  context: EditContextDto;
}

function effectiveExpired(listing: LifecycleListingRow): boolean {
  return (
    listing.status === "EXPIRED" ||
    listing.current_expires_at === null ||
    listing.current_expires_at.getTime() <= Date.now()
  );
}

function dataString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function dataNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === "number" ? value : null;
}

async function toEditListingDto(
  listing: LifecycleListingRow,
  revision: EditRevisionRow,
  imageRows: EditImageRow[],
): Promise<OwnerListingDto> {
  const data = revision.data;
  const images = [];
  for (const row of imageRows) {
    images.push(await toListingImageDto(row));
  }
  const featureIds = Array.isArray(data.feature_ids)
    ? data.feature_ids.filter((id): id is string => typeof id === "string")
    : [];
  return {
    id: listing.id,
    publicId: listing.public_id,
    status: listing.status,
    // the EDITOR contract's optimistic counter — for edit mode this is
    // the edit revision's own counter, never listings.revision
    revision: revision.revision,
    category: dataString(data, "category") ?? listing.category_code,
    brandId: dataString(data, "brand_id"),
    modelId: dataString(data, "model_id"),
    modelVariantId: dataString(data, "model_variant_id"),
    year: dataNumber(data, "year"),
    priceMinor: dataNumber(data, "price_minor"),
    currency: listing.currency,
    mileage: dataNumber(data, "mileage"),
    engineCc: dataNumber(data, "engine_cc"),
    fuelTypeId: dataString(data, "fuel_type_id"),
    transmissionId: dataString(data, "transmission_id"),
    bodyTypeId: dataString(data, "body_type_id"),
    driveTypeId: dataString(data, "drive_type_id"),
    motorcycleTypeId: dataString(data, "motorcycle_type_id"),
    colorId: dataString(data, "color_id"),
    cityId: dataString(data, "city_id"),
    creditAvailable: data.credit_available === true,
    noAccident: data.no_accident === true ? true : null,
    notRepainted: data.not_repainted === true ? true : null,
    barterAvailable: data.barter_available === true,
    description: dataString(data, "description"),
    contactPhone: dataString(data, "contact_phone"),
    sellerName: dataString(data, "seller_name"),
    // sealed OUT of the edit field space
    premiumIntentPackageId: null,
    boostIntentPackageId: null,
    featureIds,
    images,
    createdAt: revision.created_at.toISOString(),
    updatedAt: revision.updated_at.toISOString(),
  };
}

/** Edit-scoped moderation feedback: the latest CORRECTION_REQUESTED
    review recorded against THIS revision (Stage D writes these; Stage
    C reads fixtures/seeded rows). */
async function editFeedbackFor(
  sql: Sql,
  revision: EditRevisionRow,
): Promise<{ reasonCode: string | null; note: string | null } | null> {
  if (revision.status !== "CORRECTION_REQUIRED") {
    return null;
  }
  const rows = await sql<{ reason_code: string | null; note: string | null }[]>`
    select reason_code, note from moderation_reviews
    where edit_revision_id = ${revision.id}
      and decision = 'CORRECTION_REQUESTED'
    order by reviewed_at desc
    limit 1
  `;
  return rows[0] === undefined
    ? null
    : { reasonCode: rows[0].reason_code, note: rows[0].note };
}

async function buildEditView(
  sql: Sql,
  listing: LifecycleListingRow,
  revision: EditRevisionRow,
): Promise<OwnerEditView> {
  const imageRows = await listEditRevisionImages(sql, revision.id);
  const feedback = await editFeedbackFor(sql, revision);
  return {
    listing: await toEditListingDto(listing, revision, imageRows),
    context: {
      editRevisionId: revision.id,
      editStatus: revision.status,
      editSubmittedAt: revision.submitted_at?.toISOString() ?? null,
      listingStatus: listing.status,
      effectiveExpired: effectiveExpired(listing),
      sellerDeactivated: listing.seller_deactivated_at !== null,
      reactivationRequested: listing.seller_reactivation_requested_at !== null,
      management: deriveOwnerManagement({
        status: listing.status,
        currentExpiresAt: listing.current_expires_at?.toISOString() ?? null,
        sellerDeactivatedAt: listing.seller_deactivated_at?.toISOString() ?? null,
        reactivationRequested: listing.seller_reactivation_requested_at !== null,
        editStatus: revision.status as OwnerManagement["editStatus"],
      }),
      moderationFeedback: feedback,
    },
  };
}

function assertOwnedVisible(
  listing: LifecycleListingRow | undefined,
): LifecycleListingRow {
  if (listing === undefined || listing.deleted_at !== null || listing.status === "DELETED") {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  return listing;
}

/**
 * Create-or-get the open edit revision and return the full editor
 * view. Creation goes through the Stage A core (snapshot, audit,
 * outbox, unique-index race arbitration).
 */
export async function createOrGetEditView(
  auth: AuthContext,
  listingId: string,
): Promise<OwnerEditView> {
  await getOrCreateEditRevision(auth, listingId);
  const view = await getEditView(auth, listingId);
  if (view === null) {
    throw new ApiError("INTERNAL_ERROR", "Edit revision disappeared after creation.");
  }
  return view;
}

/**
 * Read the CURRENT open edit revision (never creates one — page loads
 * and editor refetches must not mutate). Returns null when no open
 * revision exists; the caller decides between 404-style conflict and a
 * redirect.
 */
export async function getEditView(
  auth: AuthContext,
  listingId: string,
): Promise<OwnerEditView | null> {
  const sql = getSql();
  const listing = assertOwnedVisible(
    await getOwnedListingForLifecycle(sql, listingId, auth.user.id),
  );
  const revision = await getOpenEditRevision(sql, listingId);
  if (revision === undefined) {
    return null;
  }
  return buildEditView(sql, listing, revision);
}

/**
 * Revision autosave: the draft-PATCH field semantics applied to
 * revision.data under the edit revision's own optimistic counter.
 * Editable in EDIT_DRAFT / CORRECTION_REQUIRED only.
 */
export async function updateEditRevision(
  auth: AuthContext,
  listingId: string,
  patch: EditPatchInput,
): Promise<OwnerEditView> {
  const { listing, updated } = await withTransaction(async (tx) => {
    const listing = assertOwnedVisible(
      await lockOwnedListingForLifecycle(tx, listingId, auth.user.id),
    );
    const open = await lockOpenEditRevision(tx, listingId);
    if (open === undefined) {
      throw new ApiError("LISTING_LIFECYCLE_CONFLICT", "No open edit revision.");
    }
    if (open.status === "PENDING_MODERATION") {
      throw new ApiError(
        "LISTING_LIFECYCLE_CONFLICT",
        "An edit under moderation cannot be changed.",
        { details: { edit_status: open.status } },
      );
    }

    const currentCategoryCode =
      dataString(open.data, "category") ?? listing.category_code;
    const category = await findActiveCategoryByCode(currentCategoryCode);
    if (category === undefined) {
      throw new ApiError(
        "LISTING_INVALID_CATALOG_SELECTION",
        "The listing category is no longer available.",
      );
    }
    const resolved = await resolveSellerContentPatch(
      {
        categoryId: category.id,
        categoryCode: currentCategoryCode,
        brandId: dataString(open.data, "brand_id"),
        modelId: dataString(open.data, "model_id"),
      },
      patch,
    );

    const changes: Record<string, unknown> = { ...resolved.changes };
    if (patch.feature_ids !== undefined) {
      changes.feature_ids = patch.feature_ids;
    } else if (resolved.categoryChanged) {
      // deterministic pruning: features incompatible with the new
      // category never survive inside the revision snapshot
      const currentIds = Array.isArray(open.data.feature_ids)
        ? open.data.feature_ids.filter((id): id is string => typeof id === "string")
        : [];
      changes.feature_ids =
        currentIds.length === 0
          ? []
          : await filterActiveFeatureIdsForCategory(currentIds, resolved.targetCategoryId);
    }

    const updated = await updateEditRevisionData(tx, {
      revisionId: open.id,
      expectedRevision: patch.expected_revision,
      data: changes,
    });
    if (updated === undefined) {
      throw new ApiError(
        "LISTING_REVISION_CONFLICT",
        "The edit was modified by another request. Reload and retry.",
        { details: { current_revision: open.revision } },
      );
    }
    return { listing, updated };
  });
  // DTO assembly (incl. signed image URLs) happens outside the locks
  return buildEditView(getSql(), listing, updated);
}

/** Sealed submit-time required-field list — the single source of truth
    (also consumed by the O.13 adjusted-approval relative check). */
export const SUBMIT_REQUIRED_FIELDS: { key: string; code: string }[] = [
  { key: "brand_id", code: "brand" },
  { key: "model_id", code: "model" },
  { key: "year", code: "year" },
  { key: "price_minor", code: "price" },
  { key: "mileage", code: "mileage" },
  { key: "city_id", code: "city" },
  { key: "contact_phone", code: "contact_phone" },
  { key: "seller_name", code: "seller_name" },
];

export const SUBMIT_REFERENCE_FIELDS: { key: string; group: string }[] = [
  { key: "fuel_type_id", group: "FUEL_TYPE" },
  { key: "transmission_id", group: "TRANSMISSION" },
  { key: "body_type_id", group: "BODY_TYPE" },
  { key: "drive_type_id", group: "DRIVE_TYPE" },
  { key: "motorcycle_type_id", group: "MOTORCYCLE_TYPE" },
  { key: "color_id", group: "COLOR" },
];

/** Full completeness + catalog revalidation of the revision snapshot —
    the same business rules the NEW flow enforces at submission. */
export async function assertRevisionSubmittable(
  tx: Sql,
  revision: EditRevisionRow,
  imageMin: number,
): Promise<void> {
  await assertContentSubmittable(revision.data);
  const confirmed = await countEditImages(tx, revision.id);
  if (confirmed < imageMin) {
    throw new ApiError(
      "LISTING_INSUFFICIENT_IMAGES",
      `At least ${imageMin} images are required.`,
      { details: { required: imageMin, confirmed } },
    );
  }
  if ((await countPrimaryEditImages(tx, revision.id)) !== 1) {
    throw new ApiError("LISTING_INSUFFICIENT_IMAGES", "A primary image is required.", {
      details: { required: imageMin, confirmed, primary: false },
    });
  }
}

/** The content half of the submit rules (required fields + catalog
    validity), shared verbatim with the O.13 adjusted-approval
    revalidation — image counts stay with each caller's own source. */
export async function assertContentSubmittable(
  data: Record<string, unknown>,
): Promise<void> {
  const missing = SUBMIT_REQUIRED_FIELDS.filter(
    (f) => data[f.key] === null || data[f.key] === undefined || data[f.key] === "",
  ).map((f) => f.code);
  if (missing.length > 0) {
    throw new ApiError("LISTING_INCOMPLETE", "The listing is incomplete.", {
      details: { missing },
    });
  }
  const invalid = (field: string): ApiError =>
    new ApiError(
      "LISTING_INVALID_CATALOG_SELECTION",
      "A selected catalog value is no longer valid.",
      { details: { field } },
    );
  const categoryCode = dataString(data, "category");
  if (categoryCode === null) throw invalid("category");
  const category = await findActiveCategoryByCode(categoryCode);
  if (category === undefined) throw invalid("category");
  const brand = await findActiveBrandInCategory(dataString(data, "brand_id")!, category.id);
  if (brand === undefined) throw invalid("brand");
  const model = await findActiveModelInBrandCategory(
    dataString(data, "model_id")!,
    dataString(data, "brand_id")!,
    category.id,
  );
  if (model === undefined) throw invalid("model");
  const variantId = dataString(data, "model_variant_id");
  if (variantId !== null) {
    const variant = await findActiveVariantInModel(variantId, dataString(data, "model_id")!);
    if (variant === undefined) throw invalid("model_variant");
  } else if (await modelHasActiveVariants(dataString(data, "model_id")!)) {
    // Owner rule: a family with active Alt models requires one
    // (both categories).
    throw new ApiError("LISTING_INCOMPLETE", "The listing is incomplete.", {
      details: { missing: ["model_variant"] },
    });
  }
  const city = await findActiveCityById(dataString(data, "city_id")!);
  if (city === undefined) throw invalid("city");
  for (const ref of SUBMIT_REFERENCE_FIELDS) {
    const value = dataString(data, ref.key);
    if (value === null) continue;
    const option = await findActiveReferenceOptionForCategory(value, ref.group, category.id);
    if (option === undefined) throw invalid(ref.group.toLowerCase());
  }
  const featureIds = Array.isArray(data.feature_ids)
    ? data.feature_ids.filter((id): id is string => typeof id === "string")
    : [];
  if (featureIds.length > 0) {
    const valid = await filterActiveFeatureIdsForCategory(featureIds, category.id);
    if (valid.length !== featureIds.length) throw invalid("features");
  }
}

export interface EditSubmissionResultDto {
  listingId: string;
  editRevisionId: string;
  editStatus: string;
  editRevision: number;
  reactivationRequested: boolean;
}

/**
 * Submit (EDIT_DRAFT) or resubmit (CORRECTION_REQUIRED) the open
 * revision into moderation. A PURE revision transition:
 * NO listing.status change, NO publication row, NO quota consumption,
 * NO listing fee, NO period, NO renewal — the approved public content
 * stays exactly as approved. `activate` records the reactivation
 * intent for the combined "göndər və aktivləşdir" flow (deactivated,
 * time-valid ACTIVE listings only); approval later finalizes it.
 */
export async function submitEditRevision(
  auth: AuthContext,
  listingId: string,
  expectedEditRevision: number,
  options: { activate?: boolean } = {},
): Promise<EditSubmissionResultDto> {
  return withTransaction(async (tx) => {
    const settings = await getSubmissionSettings(tx);
    if (settings === null) {
      throw new ApiError(
        "LISTING_PAYMENT_CONFIGURATION_ERROR",
        "Listing publication settings are not configured.",
      );
    }
    const listing = assertOwnedVisible(
      await lockOwnedListingForLifecycle(tx, listingId, auth.user.id),
    );
    if (listing.status !== "ACTIVE" && listing.status !== "EXPIRED") {
      throw new ApiError(
        "LISTING_LIFECYCLE_CONFLICT",
        "Edits can be submitted only for published or expired listings.",
        { details: { status: listing.status } },
      );
    }
    const open = await lockOpenEditRevision(tx, listingId);
    if (open === undefined) {
      throw new ApiError("LISTING_LIFECYCLE_CONFLICT", "No open edit revision.");
    }
    const result = (revision: EditRevisionRow): EditSubmissionResultDto => ({
      listingId,
      editRevisionId: revision.id,
      editStatus: revision.status,
      editRevision: revision.revision,
      reactivationRequested: listing.seller_reactivation_requested_at !== null,
    });
    if (open.status === "PENDING_MODERATION" && open.revision === expectedEditRevision) {
      return result(open); // idempotent retry — no counter bump on submit
    }
    if (open.status === "PENDING_MODERATION") {
      throw new ApiError(
        "LISTING_LIFECYCLE_CONFLICT",
        "The edit is already under moderation.",
        { details: { edit_status: open.status } },
      );
    }
    if (open.revision !== expectedEditRevision) {
      throw new ApiError(
        "LISTING_REVISION_CONFLICT",
        "The edit was modified by another request. Reload and retry.",
        { details: { current_revision: open.revision } },
      );
    }

    await assertRevisionSubmittable(tx, open, settings.imageMin);

    const submitted = await submitEditRevisionRow(tx, {
      revisionId: open.id,
      expectedRevision: expectedEditRevision,
    });
    if (submitted === undefined) {
      throw new ApiError("LISTING_REVISION_CONFLICT", "The edit changed during submission.");
    }
    // pending uploads become unusable once the revision is frozen
    await expirePendingUploadsForListing(tx, listingId);

    // combined submit-and-activate: record the intent so a future
    // approval can finalize reactivation (never here, never directly)
    let reactivationRequested = listing.seller_reactivation_requested_at !== null;
    const timeValid =
      listing.current_expires_at !== null &&
      listing.current_expires_at.getTime() > Date.now();
    if (
      options.activate === true &&
      !reactivationRequested &&
      listing.seller_deactivated_at !== null &&
      listing.status === "ACTIVE" &&
      timeValid
    ) {
      const recorded = await recordReactivationRequest(tx, {
        listingId,
        expectedRevision: listing.revision,
      });
      if (recorded) {
        reactivationRequested = true;
        await insertSellerAudit(tx, {
          actorUserId: auth.user.id,
          action: "LISTING_SELLER_REACTIVATION_REQUESTED",
          entityId: listingId,
          afterData: { edit_revision_id: open.id },
        });
      }
    }

    await insertSellerAudit(tx, {
      actorUserId: auth.user.id,
      action: "LISTING_EDIT_SUBMITTED",
      entityId: listingId,
      afterData: {
        edit_revision_id: open.id,
        resubmission: open.status === "CORRECTION_REQUIRED",
      },
    });
    await insertOutboxEvent(tx, {
      eventType: "LISTING_EDIT_SUBMITTED",
      aggregateId: listingId,
      payload: {
        listing_id: listingId,
        edit_revision_id: open.id,
        user_id: auth.user.id,
        resubmission: open.status === "CORRECTION_REQUIRED",
      },
    });

    return {
      listingId,
      editRevisionId: submitted.id,
      editStatus: submitted.status,
      editRevision: submitted.revision,
      reactivationRequested,
    };
  });
}
