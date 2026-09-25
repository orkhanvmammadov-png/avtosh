import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { listingImageConfig } from "@/lib/config/listing-images";
import { getSql, withTransaction, type Sql } from "@/lib/server/db/client";
import { getStorageProvider } from "@/providers/storage/factory";
import {
  findActiveBrandInCategory,
  findActiveCategoryByCode,
  findActiveCityById,
  findActiveModelInBrandCategory,
  findActiveVariantInModel,
  findActiveReferenceOptionForCategory,
  filterActiveFeatureIdsForCategory,
} from "@/repositories/catalog";
import { listListingImages } from "@/repositories/listing-images";
import {
  listEditRevisionImages,
  lockOpenEditRevision,
} from "@/repositories/listing-edit-revisions";
import { lockListingForLifecycle } from "@/repositories/listing-lifecycle";
import { getSubmissionSettings, insertOutboxEvent } from "@/repositories/listing-publications";
import { getListingFeatureIds, listFeatureRowsByIds, replaceListingFeatures } from "@/repositories/listings";
import {
  applyAdjustmentRow,
  discardAdjustmentRow,
  findDiscardedAdjustment,
  getOpenAdjustment,
  insertAdjustment,
  listAdjustmentAuditEvents,
  lockOpenAdjustment,
  materializeImagePlanForListing,
  materializeImagePlanFromStaged,
  updateAdjustmentWorkingState,
  type AdjustmentRow,
  type ImagePlanRowEntry,
  type SubmittedImageSnapshot,
} from "@/repositories/moderation-adjustments";
import { insertModerationAudit } from "@/repositories/moderation-audit";
import { applyApprovedEditContent } from "@/repositories/listing-edit-revisions";
import { SUBMIT_REFERENCE_FIELDS, SUBMIT_REQUIRED_FIELDS } from "@/services/listing-edit";
import { formatMileage, formatPriceMinor } from "@/lib/format";
import { buildEditSnapshot } from "@/services/listing-lifecycle";
import { resolveSellerContentPatch, type SellerContentPatch } from "@/services/listing-patch";
import { approvedContentSet, nameMaps, requireOwnedLiveClaim } from "@/services/moderation-shared";
import type { AdjustmentImagePlanEntry, AdjustmentSaveInput } from "@/validators/moderation";

/**
 * O.13 Stage B — private moderator adjustment (sealed corrections
 * A–H). ONE shared concept for NEW_LISTING and LISTING_EDIT:
 *
 * - The seller submission is FROZEN at the FIRST moderator save
 *   (submitted_data + submitted_images) — never re-read from live
 *   rows as evidence, and never mutated afterwards.
 * - Working edits live ONLY in adjusted_data/image_plan. No listings
 *   content, listing_features, listing_images, revision.data, or
 *   listing_edit_images row is ever written here.
 * - Every save requires the live owned claim, the current moderation
 *   subject (listing revision, edit revision id + no), and the
 *   adjustment's OWN optimistic counter.
 * - Every save/discard emits append-only audit attribution
 *   (MODERATION_ADJUSTMENT_SAVED / _DISCARDED) with a deterministic
 *   changed-field delta — claim takeover never erases authorship.
 * - Nothing here touches lifecycle, payments, storage, or cleanup:
 *   applying an adjustment is Stage C/D.
 */

// --- data helpers -----------------------------------------------------------

function dataString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function dataFeatureIds(data: Record<string, unknown>): string[] {
  return Array.isArray(data.feature_ids)
    ? data.feature_ids.filter((id): id is string => typeof id === "string")
    : [];
}

/** Deterministic changed-key delta between two working states (audit
    payload — correction G). Pure; unit-tested. */
export function computeAdjustmentDelta(
  before: { data: Record<string, unknown>; plan: ImagePlanRowEntry[] },
  after: { data: Record<string, unknown>; plan: ImagePlanRowEntry[] },
): string[] {
  const keys = [...new Set([...Object.keys(before.data), ...Object.keys(after.data)])].sort();
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(before.data[key] ?? null) !== JSON.stringify(after.data[key] ?? null)) {
      changed.push(key);
    }
  }
  if (JSON.stringify(before.plan) !== JSON.stringify(after.plan)) {
    changed.push("image_plan");
  }
  return changed;
}

/**
 * Validates + normalizes the client image plan against the FROZEN
 * submitted snapshot (never against client-supplied storage paths):
 * set equality with the frozen sources, no duplicates, no removed
 * primary, exactly one primary among the kept images, and at least
 * `imageMin` kept. Pure; unit-tested.
 */
export function normalizeImagePlan(
  planInput: readonly AdjustmentImagePlanEntry[],
  submitted: readonly SubmittedImageSnapshot[],
  imageMin: number,
): ImagePlanRowEntry[] {
  const known = new Set(submitted.map((image) => image.source_id));
  const seen = new Set<string>();
  const plan: ImagePlanRowEntry[] = [];
  for (const [index, entry] of planInput.entries()) {
    if (!known.has(entry.source_id)) {
      throw new ApiError("VALIDATION_ERROR", "Unknown image source for this moderation subject.", {
        details: [{ parameter: `image_plan.${index}.source_id`, message: "Unknown source" }],
      });
    }
    if (seen.has(entry.source_id)) {
      throw new ApiError("VALIDATION_ERROR", "Duplicate image source in the plan.", {
        details: [{ parameter: `image_plan.${index}.source_id`, message: "Duplicate source" }],
      });
    }
    seen.add(entry.source_id);
    if (entry.removed && entry.is_primary) {
      throw new ApiError("VALIDATION_ERROR", "A removed image cannot be the primary image.", {
        details: [{ parameter: `image_plan.${index}.is_primary`, message: "Removed primary" }],
      });
    }
    plan.push({
      source_id: entry.source_id,
      removed: entry.removed,
      sort_order: index,
      is_primary: entry.is_primary,
    });
  }
  if (seen.size !== known.size) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "The image plan must cover every submitted image exactly once.",
    );
  }
  const kept = plan.filter((entry) => !entry.removed);
  if (kept.length < imageMin) {
    throw new ApiError("LISTING_INSUFFICIENT_IMAGES", "The plan keeps fewer images than the minimum.", {
      details: { image_min: imageMin, kept: kept.length },
    });
  }
  const primaries = kept.filter((entry) => entry.is_primary).length;
  if (kept.length > 0 && primaries !== 1) {
    throw new ApiError("VALIDATION_ERROR", "Exactly one kept image must be primary.", {
      details: { primaries },
    });
  }
  return plan;
}

/** The identity plan of a frozen snapshot (submitted order/primary,
    nothing removed) — the audit baseline for the first save's delta. */
function identityPlan(submitted: readonly SubmittedImageSnapshot[]): ImagePlanRowEntry[] {
  return submitted.map((image, index) => ({
    source_id: image.source_id,
    removed: false,
    sort_order: index,
    is_primary: image.is_primary,
  }));
}

interface ImageSourceRow {
  id: string;
  storage_path: string;
  sort_order: number;
  is_primary: boolean;
  width: number | null;
  height: number | null;
  mime_type: string;
}

function freezeImages(rows: ImageSourceRow[]): SubmittedImageSnapshot[] {
  return rows.map((row) => ({
    source_id: row.id,
    storage_path: row.storage_path,
    sort_order: row.sort_order,
    is_primary: row.is_primary,
    width: row.width,
    height: row.height,
    mime_type: row.mime_type,
  }));
}

// --- subject resolution -----------------------------------------------------

interface ResolvedSubject {
  listingRevision: number;
  editRevisionId: string | null;
  editRevisionNo: number | null;
  /** The live seller content of the pass (frozen on first save). */
  submittedData: Record<string, unknown>;
  submittedImages: SubmittedImageSnapshot[];
}

/**
 * Locks (listing → edit revision) and proves the moderation subject
 * the client edited is still the current one. NEW: pending listing at
 * the expected listing revision. EDIT: the SAME pending edit revision
 * at the expected edit counter.
 */
async function resolveCurrentSubject(
  tx: Sql,
  listingId: string,
  input: {
    expectedListingRevision: number;
    editRevisionId?: string;
    expectedEditRevision?: number;
  },
): Promise<ResolvedSubject> {
  const listing = await lockListingForLifecycle(tx, listingId);
  if (listing === undefined || listing.deleted_at !== null || listing.status === "DELETED") {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  if (input.editRevisionId === undefined) {
    // NEW_LISTING subject
    if (listing.status !== "PENDING_MODERATION") {
      throw new ApiError("MODERATION_SUBJECT_CHANGED", "The listing is no longer awaiting moderation.", {
        details: { status: listing.status },
      });
    }
    if (listing.revision !== input.expectedListingRevision) {
      throw new ApiError("MODERATION_SUBJECT_CHANGED", "The submission changed since it was reviewed.", {
        details: { current_revision: listing.revision },
      });
    }
    const featureIds = await getListingFeatureIds(tx, listingId);
    const images = await listListingImages(tx, listingId);
    return {
      listingRevision: listing.revision,
      editRevisionId: null,
      editRevisionNo: null,
      submittedData: buildEditSnapshot(listing, featureIds),
      submittedImages: freezeImages(images),
    };
  }
  // LISTING_EDIT subject (lock order: listing already held, revision second)
  const revision = await lockOpenEditRevision(tx, listingId);
  if (
    revision === undefined ||
    revision.id !== input.editRevisionId ||
    revision.status !== "PENDING_MODERATION"
  ) {
    throw new ApiError("MODERATION_SUBJECT_CHANGED", "The edit is no longer awaiting moderation.", {
      details: { edit_status: revision?.status ?? null },
    });
  }
  if (revision.revision !== input.expectedEditRevision) {
    throw new ApiError("MODERATION_SUBJECT_CHANGED", "The edit changed since it was reviewed.", {
      details: { current_edit_revision: revision.revision },
    });
  }
  if (listing.revision !== input.expectedListingRevision) {
    throw new ApiError("MODERATION_SUBJECT_CHANGED", "The listing changed since it was reviewed.", {
      details: { current_revision: listing.revision },
    });
  }
  const images = await listEditRevisionImages(tx, revision.id);
  return {
    listingRevision: listing.revision,
    editRevisionId: revision.id,
    editRevisionNo: revision.revision,
    submittedData: revision.data,
    submittedImages: freezeImages(images),
  };
}

/** The stored adjustment must address the SAME frozen pass the client
    is working on — an old correction-cycle adjustment can never
    silently attach to a later seller pass. */
function assertAdjustmentMatchesSubject(adjustment: AdjustmentRow, subject: ResolvedSubject): void {
  if (
    adjustment.edit_revision_id !== subject.editRevisionId ||
    adjustment.submitted_edit_revision_no !== subject.editRevisionNo ||
    adjustment.submitted_listing_revision !== subject.listingRevision
  ) {
    throw new ApiError("MODERATION_SUBJECT_CHANGED", "The saved adjustment belongs to a previous moderation pass.", {
      details: { adjustment_id: adjustment.id },
    });
  }
}

// --- content resolution -----------------------------------------------------

/** Applies the moderator payload onto a base working state through the
    SAME seller validation pipeline (resolveSellerContentPatch) — never
    a second moderator validation model. */
async function resolveAdjustedData(
  base: Record<string, unknown>,
  content: SellerContentPatch,
): Promise<Record<string, unknown>> {
  const baseCategoryCode = dataString(base, "category");
  const category = baseCategoryCode === null ? undefined : await findActiveCategoryByCode(baseCategoryCode);
  if (category === undefined) {
    throw new ApiError("LISTING_INVALID_CATALOG_SELECTION", "The listing category is no longer available.");
  }
  const resolved = await resolveSellerContentPatch(
    {
      categoryId: category.id,
      categoryCode: category.code,
      brandId: dataString(base, "brand_id"),
      modelId: dataString(base, "model_id"),
    },
    content,
  );
  const next: Record<string, unknown> = { ...base, ...resolved.changes };
  if (content.feature_ids !== undefined) {
    next.feature_ids = content.feature_ids;
  } else if (resolved.categoryChanged) {
    // deterministic pruning — identical to the seller edit revision
    const currentIds = dataFeatureIds(base);
    next.feature_ids =
      currentIds.length === 0
        ? []
        : await filterActiveFeatureIdsForCategory(currentIds, resolved.targetCategoryId);
  }
  return next;
}

// --- save -------------------------------------------------------------------

export interface AdjustmentSaveResultDto {
  id: string;
  revision: number;
  status: string;
  savedAt: string;
  changedFields: string[];
}

export async function saveAdjustment(
  auth: AuthContext,
  listingId: string,
  input: AdjustmentSaveInput,
): Promise<AdjustmentSaveResultDto> {
  const { row, changedFields } = await withTransaction(async (tx) => {
    // sealed lock order: listing → edit revision → adjustment
    const subject = await resolveCurrentSubject(tx, listingId, {
      expectedListingRevision: input.expected_listing_revision,
      editRevisionId: input.edit_revision_id,
      expectedEditRevision: input.expected_edit_revision,
    });
    await requireOwnedLiveClaim(tx, listingId, auth.user.id);
    const settings = await getSubmissionSettings(tx);
    if (settings === null) {
      throw new ApiError("LISTING_CONFIGURATION_ERROR", "Listing settings are not configured.");
    }
    const existing = await lockOpenAdjustment(tx, listingId);

    if (input.expected_adjustment_revision === null) {
      // FIRST save: freeze the seller pass + create the working copy
      if (existing !== undefined) {
        throw new ApiError(
          "MODERATION_ADJUSTMENT_CONFLICT",
          "A saved adjustment already exists — reload before editing.",
          { details: { adjustment_id: existing.id, current_revision: existing.revision } },
        );
      }
      const adjustedData = await resolveAdjustedData(subject.submittedData, input.content);
      const imagePlan = normalizeImagePlan(input.image_plan, subject.submittedImages, settings.imageMin);
      const inserted = await insertAdjustment(tx, {
        listingId,
        editRevisionId: subject.editRevisionId,
        submittedListingRevision: subject.listingRevision,
        submittedEditRevisionNo: subject.editRevisionNo,
        submittedData: subject.submittedData,
        submittedImages: subject.submittedImages,
        adjustedData,
        imagePlan,
        moderatorId: auth.user.id,
      });
      if (inserted === null) {
        // one-OPEN unique index refused: a concurrent first save won
        throw new ApiError(
          "MODERATION_ADJUSTMENT_CONFLICT",
          "A saved adjustment already exists — reload before editing.",
        );
      }
      const changedFields = computeAdjustmentDelta(
        { data: subject.submittedData, plan: identityPlan(subject.submittedImages) },
        { data: adjustedData, plan: imagePlan },
      );
      await auditSave(tx, auth.user.id, listingId, inserted, changedFields);
      return { row: inserted, changedFields };
    }

    // UPDATE save: same pass, own counter
    if (existing === undefined) {
      throw new ApiError("MODERATION_ADJUSTMENT_CONFLICT", "No open adjustment exists — reload.", {
        details: { current_revision: null },
      });
    }
    assertAdjustmentMatchesSubject(existing, subject);
    if (existing.revision !== input.expected_adjustment_revision) {
      throw new ApiError(
        "MODERATION_ADJUSTMENT_CONFLICT",
        "The adjustment changed since it was loaded. Reload and re-apply.",
        { details: { current_revision: existing.revision } },
      );
    }
    const adjustedData = await resolveAdjustedData(existing.adjusted_data, input.content);
    const imagePlan = normalizeImagePlan(input.image_plan, existing.submitted_images, settings.imageMin);
    const updated = await updateAdjustmentWorkingState(tx, {
      adjustmentId: existing.id,
      expectedRevision: existing.revision,
      adjustedData,
      imagePlan,
      moderatorId: auth.user.id,
    });
    if (updated === undefined) {
      throw new ApiError("MODERATION_ADJUSTMENT_CONFLICT", "The adjustment changed during the save.");
    }
    const changedFields = computeAdjustmentDelta(
      { data: existing.adjusted_data, plan: existing.image_plan },
      { data: adjustedData, plan: imagePlan },
    );
    await auditSave(tx, auth.user.id, listingId, updated, changedFields);
    return { row: updated, changedFields };
  });
  return {
    id: row.id,
    revision: row.revision,
    status: row.status,
    savedAt: row.updated_at.toISOString(),
    changedFields,
  };
}

async function auditSave(
  tx: Sql,
  actorUserId: string,
  listingId: string,
  row: AdjustmentRow,
  changedFields: string[],
): Promise<void> {
  // correction G: append-only per-save attribution — audit_logs rows
  // are immutable (trigger-enforced), so lineage survives takeovers
  await insertModerationAudit(tx, {
    actorUserId,
    action: "MODERATION_ADJUSTMENT_SAVED",
    entityId: listingId,
    afterData: {
      adjustment_id: row.id,
      adjustment_revision: row.revision,
      edit_revision_id: row.edit_revision_id,
      changed_fields: changedFields.join(","),
    },
  });
}

// --- Stage C: NEW decision integration --------------------------------------

const missingValue = (data: Record<string, unknown>, key: string): boolean =>
  data[key] === null || data[key] === undefined || data[key] === "";

/**
 * Adjusted-approval revalidation (Owner-UAT fix). Two rules:
 *
 * 1. RELATIVE completeness — the moderator may never degrade the
 *    submission: a sealed required field present in the FROZEN
 *    submitted_data must still be present in adjusted_data. A field
 *    the seller never submitted (legacy-era pending listings, e.g.
 *    pre-O.9 rows without seller_name) does NOT block, because the
 *    plain no-adjustment approval path would approve that submission
 *    unchanged — adjusted approval must never be stricter than the
 *    sealed approval baseline for content the moderator did not touch.
 * 2. Catalog validity of every PRESENT adjusted value: category,
 *    brand-in-category, model-in-brand+category, city, reference
 *    options and features must all still be valid today.
 */
export async function assertAdjustedContentApprovable(
  submitted: Record<string, unknown>,
  adjusted: Record<string, unknown>,
): Promise<void> {
  const degraded = SUBMIT_REQUIRED_FIELDS.filter(
    (field) => missingValue(adjusted, field.key) && !missingValue(submitted, field.key),
  ).map((field) => field.code);
  if (degraded.length > 0) {
    throw new ApiError("LISTING_INCOMPLETE", "The adjustment removed required content.", {
      details: { missing: degraded },
    });
  }
  const invalid = (field: string): ApiError =>
    new ApiError(
      "LISTING_INVALID_CATALOG_SELECTION",
      "A selected catalog value is no longer valid.",
      { details: { field } },
    );
  const categoryCode = dataString(adjusted, "category");
  if (categoryCode === null) throw invalid("category");
  const category = await findActiveCategoryByCode(categoryCode);
  if (category === undefined) throw invalid("category");
  const brandId = dataString(adjusted, "brand_id");
  if (brandId !== null && (await findActiveBrandInCategory(brandId, category.id)) === undefined) {
    throw invalid("brand");
  }
  const modelId = dataString(adjusted, "model_id");
  if (modelId !== null) {
    if (brandId === null) throw invalid("model");
    if ((await findActiveModelInBrandCategory(modelId, brandId, category.id)) === undefined) {
      throw invalid("model");
    }
  }
  const variantId = dataString(adjusted, "model_variant_id");
  if (variantId !== null) {
    if (modelId === null) throw invalid("model_variant");
    if ((await findActiveVariantInModel(variantId, modelId)) === undefined) {
      throw invalid("model_variant");
    }
  }
  const cityId = dataString(adjusted, "city_id");
  if (cityId !== null && (await findActiveCityById(cityId)) === undefined) {
    throw invalid("city");
  }
  for (const ref of SUBMIT_REFERENCE_FIELDS) {
    const value = dataString(adjusted, ref.key);
    if (value === null) continue;
    if ((await findActiveReferenceOptionForCategory(value, ref.group, category.id)) === undefined) {
      throw invalid(ref.group.toLowerCase());
    }
  }
  const featureIds = dataFeatureIds(adjusted);
  if (featureIds.length > 0) {
    const valid = await filterActiveFeatureIdsForCategory(featureIds, category.id);
    if (valid.length !== featureIds.length) throw invalid("features");
  }
}

/**
 * O.13 Stage C — applies a saved OPEN adjustment as the approved NEW
 * content, inside the caller's approval transaction (listing already
 * locked, adjustment already locked after it, claim verified, subject
 * + adjustment revision verified by the caller). The adjustment is
 * INPUT to approval: adjusted_data and image_plan are revalidated
 * server-side, the sealed allowlisted column mapping writes the
 * scalars (one deterministic listings.revision bump), features and the
 * gallery are replaced atomically, the adjustment becomes terminal
 * APPLIED, and append-only audit + a cleanup-carrying outbox event are
 * emitted. Frozen submitted_* are never touched. Any throw rolls the
 * whole approval back — the adjustment then remains OPEN.
 */
export async function applyAdjustmentOnNewApproval(
  tx: Sql,
  input: {
    listing: { id: string; owner_id: string; revision: number };
    adjustment: AdjustmentRow;
    moderatorId: string;
  },
): Promise<{ newListingRevision: number; cleanupPaths: string[] }> {
  const { listing, adjustment } = input;
  const settings = await getSubmissionSettings(tx);
  if (settings === null) {
    throw new ApiError("LISTING_CONFIGURATION_ERROR", "Listing settings are not configured.");
  }
  // full server-side revalidation: relative completeness against the
  // frozen submission (never stricter than the sealed no-adjustment
  // approval baseline) + today's catalog validity of every present
  // value + the frozen-snapshot image-plan rules
  await assertAdjustedContentApprovable(adjustment.submitted_data, adjustment.adjusted_data);
  const plan = normalizeImagePlan(
    [...adjustment.image_plan]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((entry) => ({
        source_id: entry.source_id,
        removed: entry.removed,
        is_primary: entry.is_primary,
      })),
    adjustment.submitted_images,
    settings.imageMin,
  );

  // sealed allowlisted scalar mapping + ONE guarded revision bump
  const set = await approvedContentSet(tx, adjustment.adjusted_data);
  const newListingRevision = await applyApprovedEditContent(tx, {
    listingId: listing.id,
    expectedListingRevision: listing.revision,
    set,
  });
  if (newListingRevision === undefined) {
    throw new ApiError("MODERATION_INVALID_STATE", "Listing changed during approval.");
  }
  await replaceListingFeatures(tx, listing.id, dataFeatureIds(adjustment.adjusted_data));
  const materialized = await materializeImagePlanForListing(tx, {
    listingId: listing.id,
    kept: plan
      .filter((entry) => !entry.removed)
      .map((entry) => ({ sourceId: entry.source_id, isPrimary: entry.is_primary })),
  });
  if (materialized === undefined) {
    throw new ApiError("MODERATION_SUBJECT_CHANGED", "The submitted gallery changed during approval.");
  }

  const applied = await applyAdjustmentRow(tx, {
    adjustmentId: adjustment.id,
    expectedRevision: adjustment.revision,
  });
  if (applied === undefined) {
    throw new ApiError("MODERATION_ADJUSTMENT_CONFLICT", "The adjustment changed during approval.");
  }

  await insertModerationAudit(tx, {
    actorUserId: input.moderatorId,
    action: "MODERATION_ADJUSTMENT_APPLIED",
    entityId: listing.id,
    afterData: {
      adjustment_id: adjustment.id,
      adjustment_revision: adjustment.revision,
      submitted_listing_revision: adjustment.submitted_listing_revision,
      new_listing_revision: newListingRevision,
      removed_image_count: materialized.removedPaths.length,
    },
  });
  // reference-safe cleanup intake (worker claims this event type):
  // ONLY images removed from the final approved set become candidates.
  // Candidates are hints, never deletion authority — the worker's
  // centralized reference check also treats every retained
  // adjustment's frozen submitted_images snapshot as a live history
  // reference (sealed O.13.2 retention rule), so these objects stay
  // protected while their moderation history is retained.
  await insertOutboxEvent(tx, {
    eventType: "MODERATION_ADJUSTMENT_APPLIED",
    aggregateId: listing.id,
    payload: {
      listing_id: listing.id,
      owner_id: listing.owner_id,
      moderator_id: input.moderatorId,
      adjustment_id: adjustment.id,
      adjustment_revision: adjustment.revision,
      submitted_listing_revision: adjustment.submitted_listing_revision,
      cleanup_candidate_paths: materialized.removedPaths.join(","),
    },
  });
  return { newListingRevision, cleanupPaths: materialized.removedPaths };
}

/**
 * O.13 Stage D — applies a saved OPEN adjustment as the approved
 * LISTING_EDIT content, inside the caller's approval transaction
 * (listing → edit revision → adjustment already locked in the sealed
 * order; claim, revision counters and subject identity already
 * verified by the caller). The approval source becomes
 * adjusted_data/image_plan instead of the seller revision; the
 * seller's revision.data and staged listing_edit_images are READ-only
 * evidence and never mutated. Pure CONTENT operation — no period, no
 * fee, no quota, no expiry/status write; reactivation stays with the
 * central finalizer that decideEdit calls afterwards.
 */
export async function applyAdjustmentOnEditApproval(
  tx: Sql,
  input: {
    listing: { id: string; owner_id: string; revision: number };
    editRevisionId: string;
    adjustment: AdjustmentRow;
    moderatorId: string;
  },
): Promise<{ newListingRevision: number; cleanupPaths: string[] }> {
  const { listing, adjustment } = input;
  const settings = await getSubmissionSettings(tx);
  if (settings === null) {
    throw new ApiError("LISTING_CONFIGURATION_ERROR", "Listing settings are not configured.");
  }
  // relative-approvability (Stage C model): never stricter than the
  // no-adjustment approval baseline for content the moderator did not
  // touch; degradation refused; today's catalog validity enforced
  await assertAdjustedContentApprovable(adjustment.submitted_data, adjustment.adjusted_data);
  const plan = normalizeImagePlan(
    [...adjustment.image_plan]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((entry) => ({
        source_id: entry.source_id,
        removed: entry.removed,
        is_primary: entry.is_primary,
      })),
    adjustment.submitted_images,
    settings.imageMin,
  );

  const set = await approvedContentSet(tx, adjustment.adjusted_data);
  const newListingRevision = await applyApprovedEditContent(tx, {
    listingId: listing.id,
    expectedListingRevision: listing.revision,
    set,
  });
  if (newListingRevision === undefined) {
    throw new ApiError("MODERATION_INVALID_STATE", "Listing changed during approval.");
  }
  await replaceListingFeatures(tx, listing.id, dataFeatureIds(adjustment.adjusted_data));
  const materialized = await materializeImagePlanFromStaged(tx, {
    listingId: listing.id,
    revisionId: input.editRevisionId,
    kept: plan
      .filter((entry) => !entry.removed)
      .map((entry) => ({ sourceId: entry.source_id, isPrimary: entry.is_primary })),
  });
  if (materialized === undefined) {
    throw new ApiError("MODERATION_SUBJECT_CHANGED", "The staged gallery changed during approval.");
  }

  const applied = await applyAdjustmentRow(tx, {
    adjustmentId: adjustment.id,
    expectedRevision: adjustment.revision,
  });
  if (applied === undefined) {
    throw new ApiError("MODERATION_ADJUSTMENT_CONFLICT", "The adjustment changed during approval.");
  }

  await insertModerationAudit(tx, {
    actorUserId: input.moderatorId,
    action: "MODERATION_ADJUSTMENT_APPLIED",
    entityId: listing.id,
    afterData: {
      adjustment_id: adjustment.id,
      adjustment_revision: adjustment.revision,
      edit_revision_id: input.editRevisionId,
      submitted_edit_revision_no: adjustment.submitted_edit_revision_no,
      new_listing_revision: newListingRevision,
      removed_image_count: materialized.cleanupCandidatePaths.length,
    },
  });
  await insertOutboxEvent(tx, {
    eventType: "MODERATION_ADJUSTMENT_APPLIED",
    aggregateId: listing.id,
    payload: {
      listing_id: listing.id,
      owner_id: listing.owner_id,
      moderator_id: input.moderatorId,
      adjustment_id: adjustment.id,
      adjustment_revision: adjustment.revision,
      edit_revision_id: input.editRevisionId,
      cleanup_candidate_paths: materialized.cleanupCandidatePaths.join(","),
    },
  });
  return { newListingRevision, cleanupPaths: materialized.cleanupCandidatePaths };
}

/**
 * O.13 Stage C — sealed correction/reject behavior over a saved OPEN
 * adjustment (NEW): nothing is applied, the seller lifecycle continues
 * unchanged, and the adjustment becomes terminal DISCARDED (retained;
 * original authorship preserved in the append-only event). The next
 * seller pass starts clean — a terminal row can never re-attach.
 */
export async function discardAdjustmentOnDecision(
  tx: Sql,
  input: {
    listingId: string;
    adjustment: AdjustmentRow;
    actorUserId: string;
    decision: string;
  },
): Promise<void> {
  const discarded = await discardAdjustmentRow(tx, {
    adjustmentId: input.adjustment.id,
    expectedRevision: input.adjustment.revision,
  });
  if (discarded === undefined) {
    throw new ApiError("MODERATION_ADJUSTMENT_CONFLICT", "The adjustment changed during the decision.");
  }
  await insertModerationAudit(tx, {
    actorUserId: input.actorUserId,
    action: "MODERATION_ADJUSTMENT_DISCARDED",
    entityId: input.listingId,
    afterData: {
      adjustment_id: discarded.id,
      adjustment_revision: discarded.revision,
      last_saved_by: input.adjustment.moderator_id,
      decision: input.decision,
    },
  });
}

// --- discard ----------------------------------------------------------------

export interface AdjustmentDiscardResultDto {
  id: string;
  revision: number;
  status: string;
  discardedAt: string | null;
}

/**
 * Terminal discard of the OPEN working adjustment. The row is kept
 * (history), seller artifacts and public content are untouched, and
 * no storage cleanup is enqueued — the plan never owned objects.
 * Idempotent retry: an already-DISCARDED row at the same counter
 * returns the terminal state instead of erroring.
 */
export async function discardAdjustment(
  auth: AuthContext,
  listingId: string,
  input: { expectedAdjustmentRevision: number },
): Promise<AdjustmentDiscardResultDto> {
  return withTransaction(async (tx) => {
    const listing = await lockListingForLifecycle(tx, listingId);
    if (listing === undefined || listing.deleted_at !== null || listing.status === "DELETED") {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    await requireOwnedLiveClaim(tx, listingId, auth.user.id);
    const existing = await lockOpenAdjustment(tx, listingId);
    if (existing === undefined) {
      const terminal = await findDiscardedAdjustment(tx, {
        listingId,
        expectedRevision: input.expectedAdjustmentRevision,
      });
      if (terminal !== undefined) {
        return {
          id: terminal.id,
          revision: terminal.revision,
          status: terminal.status,
          discardedAt: terminal.discarded_at?.toISOString() ?? null,
        };
      }
      throw new ApiError("MODERATION_ADJUSTMENT_CONFLICT", "No open adjustment exists.");
    }
    if (existing.revision !== input.expectedAdjustmentRevision) {
      throw new ApiError(
        "MODERATION_ADJUSTMENT_CONFLICT",
        "The adjustment changed since it was loaded. Reload and retry.",
        { details: { current_revision: existing.revision } },
      );
    }
    const discarded = await discardAdjustmentRow(tx, {
      adjustmentId: existing.id,
      expectedRevision: existing.revision,
    });
    if (discarded === undefined) {
      throw new ApiError("MODERATION_ADJUSTMENT_CONFLICT", "The adjustment changed during the discard.");
    }
    await insertModerationAudit(tx, {
      actorUserId: auth.user.id,
      action: "MODERATION_ADJUSTMENT_DISCARDED",
      entityId: listingId,
      afterData: {
        adjustment_id: discarded.id,
        adjustment_revision: discarded.revision,
        // original authorship survives the discard event (correction H)
        last_saved_by: existing.moderator_id,
      },
    });
    return {
      id: discarded.id,
      revision: discarded.revision,
      status: discarded.status,
      discardedAt: discarded.discarded_at?.toISOString() ?? null,
    };
  });
}

// --- read model -------------------------------------------------------------

export interface AdjustmentImageViewDto {
  sourceId: string;
  removed: boolean;
  sortOrder: number;
  isPrimary: boolean;
  /** Original submitted position/primary (frozen snapshot). */
  submittedOrder: number;
  submittedPrimary: boolean;
  url: string | null;
  width: number | null;
  height: number | null;
  mimeType: string;
}

export interface AdjustmentChangeDto {
  field: string;
  submittedValue: string | null;
  adjustedValue: string | null;
}

export interface AdjustmentEventDto {
  action: string;
  actorId: string;
  actorName: string | null;
  at: string;
  adjustmentRevision: number | null;
  changedFields: string[];
}

export interface AdjustmentDto {
  id: string;
  revision: number;
  status: string;
  editRevisionId: string | null;
  submittedListingRevision: number;
  submittedEditRevisionNo: number | null;
  savedBy: { id: string; displayName: string | null };
  savedAt: string;
  createdAt: string;
  /** Raw working content (seller field space) for the edit form. */
  adjustedData: Record<string, unknown>;
  /** Raw frozen submission (evidence base for per-field helpers). */
  submittedData: Record<string, unknown>;
  imagePlan: AdjustmentImageViewDto[];
  /** Server-resolved two-way summary (Satıcı → Moderator). */
  changes: AdjustmentChangeDto[];
  /** Readable before/after blocks (O.12 description-diff treatment in
      the Satıcı → Moderator layer vocabulary); null when unchanged. */
  descriptionChange: { submitted: string | null; adjusted: string | null } | null;
  equipmentAdded: string[];
  equipmentRemoved: string[];
  photoSummary: { removedCount: number; primaryChanged: boolean; reordered: boolean };
  events: AdjustmentEventDto[];
}

const YES = "Bəli";
const NO = "Yox";

/** Shared AVTOSH money/mileage formatters — never a second formatter.
    (Wrapped only to keep the diff convention "absent = null row".) */
function formatAzn(minor: number | null): string | null {
  return minor === null ? null : formatPriceMinor(minor);
}

function formatKm(km: number | null): string | null {
  return km === null ? null : formatMileage(km);
}

function dataNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === "number" ? value : null;
}

async function signImage(path: string): Promise<string | null> {
  const config = listingImageConfig();
  return getStorageProvider()
    .createSignedReadUrl(config.imagesBucket, path, config.signedReadTtlSeconds)
    .catch(() => null);
}

/** Two-way display summary between the frozen submission and the
    working adjusted content (labels resolved server-side, same field
    keys as the O.12 edit diff so the UI shares its label map). */
async function buildChanges(
  sql: Sql,
  submitted: Record<string, unknown>,
  adjusted: Record<string, unknown>,
): Promise<AdjustmentChangeDto[]> {
  const names = await nameMaps(sql);
  const changes: AdjustmentChangeDto[] = [];
  const consider = (field: string, before: string | null, after: string | null): void => {
    if (before !== after) changes.push({ field, submittedValue: before, adjustedValue: after });
  };
  const categoryLabel = (data: Record<string, unknown>): string =>
    dataString(data, "category") === "MOTORCYCLE" ? "Motosiklet" : "Avtomobil";
  consider("category", categoryLabel(submitted), categoryLabel(adjusted));
  consider(
    "brand",
    await names.of("brands", dataString(submitted, "brand_id")),
    await names.of("brands", dataString(adjusted, "brand_id")),
  );
  consider(
    "model",
    await names.of("models", dataString(submitted, "model_id")),
    await names.of("models", dataString(adjusted, "model_id")),
  );
  consider(
    "model_variant",
    await names.of("model_variants", dataString(submitted, "model_variant_id")),
    await names.of("model_variants", dataString(adjusted, "model_variant_id")),
  );
  const num = (data: Record<string, unknown>, key: string, suffix: string): string | null => {
    const value = dataNumber(data, key);
    return value === null ? null : `${value}${suffix}`;
  };
  consider("year", num(submitted, "year", ""), num(adjusted, "year", ""));
  consider("price", formatAzn(dataNumber(submitted, "price_minor")), formatAzn(dataNumber(adjusted, "price_minor")));
  consider("mileage", formatKm(dataNumber(submitted, "mileage")), formatKm(dataNumber(adjusted, "mileage")));
  consider("engine_cc", num(submitted, "engine_cc", " sm³"), num(adjusted, "engine_cc", " sm³"));
  for (const [field, key] of [
    ["fuel_type", "fuel_type_id"],
    ["transmission", "transmission_id"],
    ["body_type", "body_type_id"],
    ["drive_type", "drive_type_id"],
    ["motorcycle_type", "motorcycle_type_id"],
    ["color", "color_id"],
  ] as const) {
    consider(
      field,
      await names.of("reference_options", dataString(submitted, key)),
      await names.of("reference_options", dataString(adjusted, key)),
    );
  }
  consider(
    "city",
    await names.of("cities", dataString(submitted, "city_id")),
    await names.of("cities", dataString(adjusted, "city_id")),
  );
  const bool = (data: Record<string, unknown>, key: string): string =>
    data[key] === true ? YES : NO;
  consider("credit", bool(submitted, "credit_available"), bool(adjusted, "credit_available"));
  consider("barter", bool(submitted, "barter_available"), bool(adjusted, "barter_available"));
  consider("no_accident", bool(submitted, "no_accident"), bool(adjusted, "no_accident"));
  consider("not_repainted", bool(submitted, "not_repainted"), bool(adjusted, "not_repainted"));
  // description is NEVER a scalar row — it renders as the dedicated
  // Satıcı → Moderator before/after blocks (descriptionChange)
  consider("seller_name", dataString(submitted, "seller_name"), dataString(adjusted, "seller_name"));
  consider("contact_phone", dataString(submitted, "contact_phone"), dataString(adjusted, "contact_phone"));
  return changes;
}

/** Detail-payload hook: the OPEN adjustment view, or null (never a
    faked moderatorAdjusted — Stage B honesty rule). */
export async function getAdjustmentViewFor(listingId: string): Promise<AdjustmentDto | null> {
  const sql = getSql();
  const row = await getOpenAdjustment(sql, listingId);
  if (row === undefined) {
    return null;
  }
  const savedByName =
    (await sql<{ display_name: string | null }[]>`
      select display_name from users where id = ${row.moderator_id}
    `)[0]?.display_name ?? null;

  const submittedById = new Map(row.submitted_images.map((image) => [image.source_id, image]));
  const imagePlan: AdjustmentImageViewDto[] = [];
  for (const entry of row.image_plan) {
    const source = submittedById.get(entry.source_id);
    if (source === undefined) continue; // impossible by validation; defensive
    imagePlan.push({
      sourceId: entry.source_id,
      removed: entry.removed,
      sortOrder: entry.sort_order,
      isPrimary: entry.is_primary,
      submittedOrder: source.sort_order,
      submittedPrimary: source.is_primary,
      url: await signImage(source.storage_path),
      width: source.width,
      height: source.height,
      mimeType: source.mime_type,
    });
  }

  const submittedFeatures = dataFeatureIds(row.submitted_data);
  const adjustedFeatures = dataFeatureIds(row.adjusted_data);
  const submittedSet = new Set(submittedFeatures);
  const adjustedSet = new Set(adjustedFeatures);
  const featureRows = await listFeatureRowsByIds(sql, [
    ...new Set([...submittedFeatures, ...adjustedFeatures]),
  ]);
  const equipmentAdded = featureRows
    .filter((f) => adjustedSet.has(f.id) && !submittedSet.has(f.id))
    .map((f) => f.name_az);
  const equipmentRemoved = featureRows
    .filter((f) => submittedSet.has(f.id) && !adjustedSet.has(f.id))
    .map((f) => f.name_az);

  const kept = row.image_plan.filter((entry) => !entry.removed);
  const submittedPrimary = row.submitted_images.find((image) => image.is_primary)?.source_id ?? null;
  const adjustedPrimary = kept.find((entry) => entry.is_primary)?.source_id ?? null;
  const keptSubmittedOrder = row.submitted_images
    .filter((image) => kept.some((entry) => entry.source_id === image.source_id))
    .map((image) => image.source_id);
  const keptPlanOrder = [...kept]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((entry) => entry.source_id);
  const events = (await listAdjustmentAuditEvents(sql, listingId)).map((event) => ({
    action: event.action,
    actorId: event.actor_user_id,
    actorName: event.actor_display_name,
    at: event.created_at.toISOString(),
    adjustmentRevision:
      typeof event.after_data.adjustment_revision === "number"
        ? event.after_data.adjustment_revision
        : null,
    changedFields:
      typeof event.after_data.changed_fields === "string" && event.after_data.changed_fields !== ""
        ? event.after_data.changed_fields.split(",")
        : [],
  }));

  return {
    id: row.id,
    revision: row.revision,
    status: row.status,
    editRevisionId: row.edit_revision_id,
    submittedListingRevision: row.submitted_listing_revision,
    submittedEditRevisionNo: row.submitted_edit_revision_no,
    savedBy: { id: row.moderator_id, displayName: savedByName },
    savedAt: row.updated_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    adjustedData: row.adjusted_data,
    submittedData: row.submitted_data,
    imagePlan,
    changes: await buildChanges(sql, row.submitted_data, row.adjusted_data),
    descriptionChange: (() => {
      const submitted = dataString(row.submitted_data, "description");
      const adjusted = dataString(row.adjusted_data, "description");
      return submitted === adjusted ? null : { submitted, adjusted };
    })(),
    equipmentAdded,
    equipmentRemoved,
    photoSummary: {
      removedCount: row.image_plan.filter((entry) => entry.removed).length,
      primaryChanged: submittedPrimary !== adjustedPrimary,
      reordered: JSON.stringify(keptSubmittedOrder) !== JSON.stringify(keptPlanOrder),
    },
    events,
  };
}
