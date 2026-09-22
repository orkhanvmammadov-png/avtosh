import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { listingImageConfig } from "@/lib/config/listing-images";
import { getSql, withTransaction, type Sql } from "@/lib/server/db/client";
import { getStorageProvider } from "@/providers/storage/factory";
import { listListingImages, type ListingImageRow } from "@/repositories/listing-images";
import {
  applyApprovedEditContent,
  decideEditRevisionRow,
  getOpenEditRevision,
  listEditRevisionImages,
  lockOpenEditRevision,
  type EditImageRow,
  type EditRevisionRow,
} from "@/repositories/listing-edit-revisions";
import { replaceListingImagesFromStaged } from "@/repositories/listing-edit-images";
import {
  clearReactivationRequest,
  lockListingForLifecycle,
  type LifecycleListingRow,
} from "@/repositories/listing-lifecycle";
import {
  getSubmissionSettings,
  insertOutboxEvent,
} from "@/repositories/listing-publications";
import { insertModerationAudit } from "@/repositories/moderation-audit";
import {
  findMatchingEditReview,
  getUnreleasedClaim,
  insertReview,
  releaseClaim,
  type ClaimRow,
  type ReviewRow,
} from "@/repositories/moderation";
import { getListingFeatureIds, listFeatureRowsByIds, replaceListingFeatures } from "@/repositories/listings";
import { getOpenAdjustment } from "@/repositories/moderation-adjustments";
import { findActiveCategoryByCode } from "@/repositories/catalog";
import { toListingImageDto, type ListingImageDto } from "@/services/listing-dto";
import {
  buildFeatureGroupsFromRows,
  type ModerationContentDto,
} from "@/services/moderation-content";
import { tryFinalizeSellerReactivation } from "@/services/listing-lifecycle";
import { assertRevisionSubmittable } from "@/services/listing-edit";

/**
 * O.12 Stage D — moderator review + decisions for LISTING_EDIT
 * revisions. Approval is a pure CONTENT operation on the approved
 * listing row: it never grants a period, touches expiry/status/
 * publication identity/payments, or clears visibility flags directly —
 * reactivation happens ONLY through the Stage A central finalizer,
 * invoked after the content swap.
 */

// --- diff model -------------------------------------------------------------

export interface ScalarChangeDto {
  /** Stable field key (client maps to the approved label). */
  field: string;
  /** Display values — names resolved, booleans as Bəli/Yox. */
  oldValue: string | null;
  newValue: string | null;
}

export interface PhotoDiffItemDto {
  url: string | null;
  isPrimary: boolean;
  badge: "ADDED" | "REMOVED" | "NEW_PRIMARY" | null;
}

export interface EditReviewDto {
  editRevisionId: string;
  editRevisionNo: number;
  submittedAt: string | null;
  /** Lifecycle context for the optional moderator info line. */
  sellerDeactivated: boolean;
  reactivationRequested: boolean;
  listingExpired: boolean;
  scalarChanges: ScalarChangeDto[];
  descriptionChange: { before: string | null; after: string | null } | null;
  equipmentAdded: string[];
  equipmentRemoved: string[];
  /** Proposed gallery in staged order (+ removed approved images at the
      end, badged) — ONE thumbnail row, never two full galleries. */
  photoDiff: PhotoDiffItemDto[];
  photosReordered: boolean;
  /** Unchanged context values for the collapsed "Digər məlumatlar". */
  unchanged: { field: string; value: string }[];
  /** O.13 Stage A: the COMPLETE seller-proposed listing content
      (labels resolved, full grouped equipment, full staged gallery
      with order/primary) — the moderator inspects the whole proposed
      listing, never only the diff. */
  sellerSubmitted: ModerationContentDto;
}

const YES = "Bəli";
const NO = "Yox";

function dataString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function dataNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === "number" ? value : null;
}

function dataFeatureIds(data: Record<string, unknown>): string[] {
  return Array.isArray(data.feature_ids)
    ? data.feature_ids.filter((id): id is string => typeof id === "string")
    : [];
}

/** Resolve display names for arbitrary catalog ids (both sides of the
    diff, including inactive rows — historical names must still render).
    Exported for the O.13 adjustment read model (same resolution rules). */
export async function nameMaps(sql: Sql): Promise<{
  of: (table: "brands" | "models" | "cities" | "reference_options" | "features" | "categories", id: string | null) => Promise<string | null>;
}> {
  const cache = new Map<string, string | null>();
  return {
    of: async (table, id) => {
      if (id === null) return null;
      const key = `${table}:${id}`;
      if (cache.has(key)) return cache.get(key)!;
      let name: string | null = null;
      if (table === "brands") {
        name = (await sql<{ name: string }[]>`select name from brands where id = ${id}`)[0]?.name ?? null;
      } else if (table === "models") {
        name = (await sql<{ name: string }[]>`select name from models where id = ${id}`)[0]?.name ?? null;
      } else if (table === "cities") {
        name = (await sql<{ name_az: string }[]>`select name_az from cities where id = ${id}`)[0]?.name_az ?? null;
      } else if (table === "reference_options") {
        name = (await sql<{ name_az: string }[]>`select name_az from reference_options where id = ${id}`)[0]?.name_az ?? null;
      } else if (table === "features") {
        name = (await sql<{ name_az: string }[]>`select name_az from features where id = ${id}`)[0]?.name_az ?? null;
      } else {
        name = (await sql<{ code: string }[]>`select code from categories where id = ${id}`)[0]?.code ?? null;
      }
      cache.set(key, name);
      return name;
    },
  };
}

function formatAzn(minor: number | null): string | null {
  if (minor === null) return null;
  const major = Math.floor(minor / 100);
  return `${String(major).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} AZN`;
}

export interface ApprovedSideRow extends LifecycleListingRow {
  brand_name: string | null;
  model_name: string | null;
  city_name: string | null;
  fuel_type: string | null;
  transmission: string | null;
  body_type: string | null;
  drive_type: string | null;
  motorcycle_type: string | null;
  color: string | null;
}

export async function approvedSide(sql: Sql, listingId: string): Promise<ApprovedSideRow | undefined> {
  const rows = await sql<ApprovedSideRow[]>`
    select
      l.id, l.public_id::text as public_id, l.owner_id, l.category_id,
      c.code as category_code,
      l.brand_id, l.model_id, l.year, l.price_minor::text as price_minor,
      l.mileage, l.engine_cc, l.fuel_type_id, l.transmission_id,
      l.body_type_id, l.drive_type_id, l.motorcycle_type_id, l.color_id,
      l.city_id, l.credit_available, l.barter_available,
      l.no_accident, l.not_repainted, l.currency, l.description,
      l.contact_phone_e164, l.seller_name,
      l.status, l.revision, l.current_expires_at,
      l.seller_deactivated_at, l.seller_reactivation_requested_at,
      l.sold_at, l.deleted_at,
      b.name as brand_name, m.name as model_name, ci.name_az as city_name,
      ft.name_az as fuel_type, tr.name_az as transmission, bt.name_az as body_type,
      dt.name_az as drive_type, mt.name_az as motorcycle_type, co.name_az as color
    from listings l
    join categories c on c.id = l.category_id
    left join brands b on b.id = l.brand_id
    left join models m on m.id = l.model_id
    left join cities ci on ci.id = l.city_id
    left join reference_options ft on ft.id = l.fuel_type_id
    left join reference_options tr on tr.id = l.transmission_id
    left join reference_options bt on bt.id = l.body_type_id
    left join reference_options dt on dt.id = l.drive_type_id
    left join reference_options mt on mt.id = l.motorcycle_type_id
    left join reference_options co on co.id = l.color_id
    where l.id = ${listingId}
  `;
  return rows[0];
}

async function signImage(path: string): Promise<string | null> {
  const config = listingImageConfig();
  return getStorageProvider()
    .createSignedReadUrl(config.imagesBucket, path, config.signedReadTtlSeconds)
    .catch(() => null);
}

/**
 * Server-computed changed-first comparison of the approved listing
 * against the PENDING revision — the moderator UI renders it verbatim
 * (06-moderator-diff.md). Unchanged values never appear as changes.
 */
export async function buildEditReview(
  sql: Sql,
  listing: ApprovedSideRow,
  revision: EditRevisionRow,
): Promise<EditReviewDto> {
  const data = revision.data;
  const names = await nameMaps(sql);

  const changes: ScalarChangeDto[] = [];
  const unchanged: { field: string; value: string }[] = [];
  const consider = (field: string, oldValue: string | null, newValue: string | null): void => {
    if (oldValue === newValue) {
      if (oldValue !== null) unchanged.push({ field, value: oldValue });
      return;
    }
    changes.push({ field, oldValue, newValue });
  };

  // O.13 Stage A: every proposed value is resolved ONCE and reused by
  // both the changed-first diff and the full sellerSubmitted read model
  const proposedCategory = dataString(data, "category") ?? listing.category_code;
  const proposed = {
    brandName: await names.of("brands", dataString(data, "brand_id")),
    modelName: await names.of("models", dataString(data, "model_id")),
    year: dataNumber(data, "year"),
    priceMinor: dataNumber(data, "price_minor"),
    mileage: dataNumber(data, "mileage"),
    engineCc: dataNumber(data, "engine_cc"),
    fuelType: await names.of("reference_options", dataString(data, "fuel_type_id")),
    transmission: await names.of("reference_options", dataString(data, "transmission_id")),
    bodyType: await names.of("reference_options", dataString(data, "body_type_id")),
    driveType: await names.of("reference_options", dataString(data, "drive_type_id")),
    motorcycleType: await names.of("reference_options", dataString(data, "motorcycle_type_id")),
    color: await names.of("reference_options", dataString(data, "color_id")),
    cityName: await names.of("cities", dataString(data, "city_id")),
    creditAvailable: data.credit_available === true,
    barterAvailable: data.barter_available === true,
    noAccident: data.no_accident === true,
    notRepainted: data.not_repainted === true,
    description: dataString(data, "description"),
    sellerName: dataString(data, "seller_name"),
    contactPhone: dataString(data, "contact_phone"),
  };

  consider(
    "category",
    listing.category_code === "MOTORCYCLE" ? "Motosiklet" : "Avtomobil",
    proposedCategory === "MOTORCYCLE" ? "Motosiklet" : "Avtomobil",
  );
  consider("brand", listing.brand_name, proposed.brandName);
  consider("model", listing.model_name, proposed.modelName);
  consider(
    "year",
    listing.year === null ? null : String(listing.year),
    proposed.year === null ? null : String(proposed.year),
  );
  consider(
    "price",
    formatAzn(listing.price_minor === null ? null : Number(listing.price_minor)),
    formatAzn(proposed.priceMinor),
  );
  consider(
    "mileage",
    listing.mileage === null ? null : `${listing.mileage} km`,
    proposed.mileage === null ? null : `${proposed.mileage} km`,
  );
  consider(
    "engine_cc",
    listing.engine_cc === null ? null : `${listing.engine_cc} sm³`,
    proposed.engineCc === null ? null : `${proposed.engineCc} sm³`,
  );
  consider("fuel_type", listing.fuel_type, proposed.fuelType);
  consider("transmission", listing.transmission, proposed.transmission);
  consider("body_type", listing.body_type, proposed.bodyType);
  consider("drive_type", listing.drive_type, proposed.driveType);
  consider("motorcycle_type", listing.motorcycle_type, proposed.motorcycleType);
  consider("color", listing.color, proposed.color);
  consider("city", listing.city_name, proposed.cityName);
  consider("credit", listing.credit_available ? YES : NO, proposed.creditAvailable ? YES : NO);
  consider("barter", listing.barter_available ? YES : NO, proposed.barterAvailable ? YES : NO);
  consider("no_accident", listing.no_accident === true ? YES : NO, proposed.noAccident ? YES : NO);
  consider("not_repainted", listing.not_repainted === true ? YES : NO, proposed.notRepainted ? YES : NO);
  consider("seller_name", listing.seller_name, proposed.sellerName);
  consider("contact_phone", listing.contact_phone_e164, proposed.contactPhone);

  // description: readable before/after blocks — never a scalar row
  const oldDescription = listing.description;
  const newDescription = dataString(data, "description");
  const descriptionChange =
    oldDescription === newDescription ? null : { before: oldDescription, after: newDescription };

  // equipment by stable feature identity (order-independent); ONE
  // batch name/group lookup over both sides feeds the +/− diff AND the
  // full grouped proposed set (O.13 Stage A — no per-feature queries)
  const approvedFeatures = await getListingFeatureIds(sql, listing.id);
  const proposedFeatures = dataFeatureIds(data);
  const approvedSet = new Set(approvedFeatures);
  const proposedSet = new Set(proposedFeatures);
  const featureRows = await listFeatureRowsByIds(sql, [
    ...new Set([...approvedFeatures, ...proposedFeatures]),
  ]);
  const featureNames = new Map(featureRows.map((row) => [row.id, row.name_az]));
  const equipmentAdded: string[] = [];
  const equipmentRemoved: string[] = [];
  for (const id of proposedFeatures) {
    if (!approvedSet.has(id)) {
      const name = featureNames.get(id);
      if (name !== undefined) equipmentAdded.push(name);
    }
  }
  for (const id of approvedFeatures) {
    if (!proposedSet.has(id)) {
      const name = featureNames.get(id);
      if (name !== undefined) equipmentRemoved.push(name);
    }
  }

  // photos by storage_path identity: a shared path is the SAME image
  // (staged snapshot copies have new row ids by design)
  const approvedImages = await listListingImages(sql, listing.id);
  const stagedImages = await listEditRevisionImages(sql, revision.id);
  // full proposed gallery signed ONCE — the badge diff reuses the URLs
  const stagedDtos: ListingImageDto[] = [];
  for (const img of stagedImages) {
    stagedDtos.push(await toListingImageDto(img));
  }
  const approvedPaths = approvedImages.map((img: ListingImageRow) => img.storage_path);
  const stagedPaths = stagedImages.map((img: EditImageRow) => img.storage_path);
  const approvedPathSet = new Set(approvedPaths);
  const stagedPathSet = new Set(stagedPaths);
  const oldPrimary = approvedImages.find((img) => img.is_primary)?.storage_path ?? null;
  const newPrimary = stagedImages.find((img) => img.is_primary)?.storage_path ?? null;
  const primaryChanged = oldPrimary !== newPrimary;

  const photoDiff: PhotoDiffItemDto[] = [];
  for (const [index, img] of stagedImages.entries()) {
    photoDiff.push({
      url: stagedDtos[index].url,
      isPrimary: img.is_primary,
      badge: !approvedPathSet.has(img.storage_path)
        ? "ADDED"
        : primaryChanged && img.is_primary
          ? "NEW_PRIMARY"
          : null,
    });
  }
  for (const img of approvedImages) {
    if (!stagedPathSet.has(img.storage_path)) {
      photoDiff.push({ url: await signImage(img.storage_path), isPrimary: false, badge: "REMOVED" });
    }
  }
  const sharedApprovedOrder = approvedPaths.filter((p) => stagedPathSet.has(p));
  const sharedStagedOrder = stagedPaths.filter((p) => approvedPathSet.has(p));
  const photosReordered =
    sharedApprovedOrder.length === sharedStagedOrder.length &&
    sharedApprovedOrder.some((p, i) => p !== sharedStagedOrder[i]);

  return {
    editRevisionId: revision.id,
    editRevisionNo: revision.revision,
    submittedAt: revision.submitted_at?.toISOString() ?? null,
    sellerDeactivated: listing.seller_deactivated_at !== null,
    reactivationRequested: listing.seller_reactivation_requested_at !== null,
    listingExpired:
      listing.status === "EXPIRED" ||
      listing.current_expires_at === null ||
      listing.current_expires_at.getTime() <= Date.now(),
    scalarChanges: changes,
    descriptionChange,
    equipmentAdded,
    equipmentRemoved,
    photoDiff,
    photosReordered,
    unchanged,
    sellerSubmitted: {
      category: proposedCategory,
      brandName: proposed.brandName,
      modelName: proposed.modelName,
      year: proposed.year,
      priceMinor: proposed.priceMinor,
      currency: listing.currency,
      mileage: proposed.mileage,
      engineCc: proposed.engineCc,
      fuelType: proposed.fuelType,
      transmission: proposed.transmission,
      bodyType: proposed.bodyType,
      driveType: proposed.driveType,
      motorcycleType: proposed.motorcycleType,
      color: proposed.color,
      cityName: proposed.cityName,
      creditAvailable: proposed.creditAvailable,
      barterAvailable: proposed.barterAvailable,
      // positive-claim semantics (true or null) match the approved
      // content the swap would write — absence is never a negative
      noAccident: proposed.noAccident ? true : null,
      notRepainted: proposed.notRepainted ? true : null,
      description: proposed.description,
      sellerName: proposed.sellerName,
      contactPhone: proposed.contactPhone,
      featureGroups: buildFeatureGroupsFromRows(
        featureRows.filter((row) => proposedSet.has(row.id)),
      ),
      images: stagedDtos,
    },
  };
}

/** Detail-payload hook: the pending edit review for a listing, or null. */
export async function getEditReviewFor(listingId: string): Promise<EditReviewDto | null> {
  const sql = getSql();
  const revision = await getOpenEditRevision(sql, listingId);
  if (revision === undefined || revision.status !== "PENDING_MODERATION") {
    return null;
  }
  const listing = await approvedSide(sql, listingId);
  if (listing === undefined || listing.deleted_at !== null) {
    return null;
  }
  return buildEditReview(sql, listing, revision);
}

// --- decisions --------------------------------------------------------------

export interface EditDecisionResultDto {
  listing: { id: string; status: string; revision: number };
  editRevision: { id: string; status: string; revisionNo: number };
  review: {
    id: string;
    decision: ReviewRow["decision"];
    reasonCode: string | null;
    note: string | null;
    reviewedAt: string;
  };
  /** True only when the central finalizer reactivated the listing. */
  reactivated: boolean;
}

/** Exported for the O.13 adjustment writes — the SAME live-claim
    ownership gate as decisions (never a parallel claim model). */
export async function requireOwnedLiveClaim(tx: Sql, listingId: string, moderatorId: string): Promise<ClaimRow> {
  const claim = await getUnreleasedClaim(tx, listingId);
  if (claim === undefined || claim.expires_at.getTime() <= Date.now()) {
    throw new ApiError("MODERATION_CLAIM_REQUIRED", "Claim the listing before deciding.");
  }
  if (claim.moderator_id !== moderatorId) {
    throw new ApiError("MODERATION_CLAIMED_BY_OTHER", "Another moderator holds the claim.");
  }
  return claim;
}

function toResult(
  listing: { id: string; status: string; revision: number },
  revision: EditRevisionRow,
  review: ReviewRow,
  reactivated: boolean,
): EditDecisionResultDto {
  return {
    listing,
    editRevision: { id: revision.id, status: revision.status, revisionNo: revision.revision },
    review: {
      id: review.id,
      decision: review.decision,
      reasonCode: review.reason_code,
      note: review.note,
      reviewedAt: review.reviewed_at.toISOString(),
    },
    reactivated,
  };
}

/** Sealed seller-editable column set the approval copy writes — and
    NOTHING else (no lifecycle/publication/payment/promotion columns).
    Exported for the O.13 adjusted NEW approval — the SAME allowlisted
    mapping, never a generic spread. */
export async function approvedContentSet(
  tx: Sql,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const categoryCode = dataString(data, "category");
  const category = categoryCode === null ? undefined : await findActiveCategoryByCode(categoryCode);
  if (category === undefined) {
    throw new ApiError("LISTING_INVALID_CATALOG_SELECTION", "The revision category is no longer valid.");
  }
  return {
    category_id: category.id,
    brand_id: dataString(data, "brand_id"),
    model_id: dataString(data, "model_id"),
    year: dataNumber(data, "year"),
    price_minor: dataNumber(data, "price_minor"),
    mileage: dataNumber(data, "mileage"),
    engine_cc: dataNumber(data, "engine_cc"),
    fuel_type_id: dataString(data, "fuel_type_id"),
    transmission_id: dataString(data, "transmission_id"),
    body_type_id: dataString(data, "body_type_id"),
    drive_type_id: dataString(data, "drive_type_id"),
    motorcycle_type_id: dataString(data, "motorcycle_type_id"),
    color_id: dataString(data, "color_id"),
    city_id: dataString(data, "city_id"),
    credit_available: data.credit_available === true,
    barter_available: data.barter_available === true,
    no_accident: data.no_accident === true ? true : null,
    not_repainted: data.not_repainted === true ? true : null,
    description: dataString(data, "description"),
    contact_phone_e164: dataString(data, "contact_phone"),
    seller_name: dataString(data, "seller_name"),
  };
}

type EditDecision = "APPROVED" | "REJECTED" | "CORRECTION_REQUIRED";

const DECISION_TO_REVIEW: Record<EditDecision, ReviewRow["decision"]> = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CORRECTION_REQUIRED: "CORRECTION_REQUESTED",
};

const DECISION_EVENT: Record<EditDecision, string> = {
  APPROVED: "LISTING_EDIT_APPROVED",
  REJECTED: "LISTING_EDIT_REJECTED",
  CORRECTION_REQUIRED: "LISTING_EDIT_CORRECTION_REQUESTED",
};

async function decideEdit(
  auth: AuthContext,
  listingId: string,
  input: {
    expectedEditRevision: number;
    decision: EditDecision;
    reasonCode: string | null;
    note: string | null;
  },
): Promise<EditDecisionResultDto> {
  return withTransaction(async (tx) => {
    // sealed lock order: listing row FIRST, revision second
    const listing = await lockListingForLifecycle(tx, listingId);
    if (listing === undefined || listing.deleted_at !== null || listing.status === "DELETED") {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    const open = await lockOpenEditRevision(tx, listingId);
    if (open === undefined || open.status !== "PENDING_MODERATION") {
      // Idempotent retry (existing moderation convention): return the
      // identical already-committed decision, never re-apply effects.
      // The decided revision may no longer be "open", so it is looked
      // up through its review row.
      const byReview = await tx<EditRevisionRow[]>`
        select er.* from listing_edit_revisions er
        join moderation_reviews mr on mr.edit_revision_id = er.id
        where er.listing_id = ${listingId}
          and mr.moderator_id = ${auth.user.id}
          and mr.edit_revision_no = ${input.expectedEditRevision}
          and mr.decision = ${DECISION_TO_REVIEW[input.decision]}::moderation_decision
        order by mr.reviewed_at desc
        limit 1
      `;
      if (byReview[0] !== undefined) {
        const review = await findMatchingEditReview(tx, {
          editRevisionId: byReview[0].id,
          moderatorId: auth.user.id,
          editRevisionNo: input.expectedEditRevision,
          decision: DECISION_TO_REVIEW[input.decision],
        });
        if (review !== undefined) {
          return toResult(
            { id: listing.id, status: listing.status, revision: listing.revision },
            byReview[0],
            review,
            false,
          );
        }
      }
      throw new ApiError("MODERATION_INVALID_STATE", "No edit is awaiting moderation.", {
        details: { edit_status: open?.status ?? null },
      });
    }
    if (open.revision !== input.expectedEditRevision) {
      throw new ApiError(
        "LISTING_REVISION_CONFLICT",
        "The edit changed since it was reviewed. Reload and re-review.",
        { details: { current_revision: open.revision } },
      );
    }
    const claim = await requireOwnedLiveClaim(tx, listingId, auth.user.id);
    // O.13 Stage B safety: a saved OPEN moderator adjustment must never
    // let the pre-O.13 decision path run against seller content as if
    // no adjustment existed. Approval-with-adjustment (and the sealed
    // correction/reject terminalization) is wired in Stage C/D — until
    // then every decision on such a subject is a typed refusal.
    const openAdjustment = await getOpenAdjustment(tx, listingId);
    if (openAdjustment !== undefined) {
      throw new ApiError(
        "MODERATION_ADJUSTMENT_PENDING",
        "A saved moderator adjustment exists; adjusted decisions are not enabled yet.",
        { details: { adjustment_id: openAdjustment.id } },
      );
    }

    // review row records BOTH counters with their original meanings:
    // the approved listing revision reviewed against + the edit's own
    const review = await insertReview(tx, {
      listingId,
      moderatorId: auth.user.id,
      listingRevision: listing.revision,
      decision: DECISION_TO_REVIEW[input.decision],
      reasonCode: input.reasonCode,
      note: input.note,
      editRevisionId: open.id,
      editRevisionNo: open.revision,
    });

    let reactivated = false;
    let finalListing = { id: listing.id, status: listing.status, revision: listing.revision };
    let cleanupPaths: string[] = [];

    if (input.decision === "APPROVED") {
      // final content re-validation — invalid staged content can never
      // become public even if catalog rules changed since submission
      const settings = await getSubmissionSettings(tx);
      if (settings === null) {
        throw new ApiError("LISTING_CONFIGURATION_ERROR", "Listing settings are not configured.");
      }
      await assertRevisionSubmittable(tx, open, settings.imageMin);

      // A: scalar copy + B: listings.revision bump (guarded)
      const set = await approvedContentSet(tx, open.data);
      const newRevision = await applyApprovedEditContent(tx, {
        listingId,
        expectedListingRevision: listing.revision,
        set,
      });
      if (newRevision === undefined) {
        throw new ApiError("MODERATION_INVALID_STATE", "Listing changed during approval.");
      }
      // C: features become the staged set
      await replaceListingFeatures(tx, listingId, dataFeatureIds(open.data));
      // D: the public gallery becomes the staged gallery atomically
      const swap = await replaceListingImagesFromStaged(tx, {
        listingId,
        revisionId: open.id,
      });
      const stagedPaths = new Set(
        (await listEditRevisionImages(tx, open.id)).map((img) => img.storage_path),
      );
      // orphan CANDIDATES only (reference-checking worker decides) —
      // paths still present in the new gallery are never candidates
      cleanupPaths = swap.removedPaths.filter((path) => !stagedPaths.has(path));
      finalListing = { id: listing.id, status: listing.status, revision: newRevision };
    }

    // E/F: revision transition under its own counter (stale-safe)
    const decided = await decideEditRevisionRow(tx, {
      revisionId: open.id,
      expectedRevision: open.revision,
      toStatus: input.decision,
    });
    if (decided === undefined) {
      throw new ApiError("MODERATION_INVALID_STATE", "The edit changed during the decision.");
    }

    if (input.decision === "REJECTED") {
      // a stale activation request must never publish the old approved
      // version later — corrections PRESERVE it, rejection clears it
      await clearReactivationRequest(tx, listingId);
    }

    await insertModerationAudit(tx, {
      actorUserId: auth.user.id,
      action: DECISION_EVENT[input.decision],
      entityId: listingId,
      afterData: {
        edit_revision_id: open.id,
        edit_revision_no: open.revision,
        reason_code: input.reasonCode,
      },
    });
    await insertOutboxEvent(tx, {
      eventType: DECISION_EVENT[input.decision],
      aggregateId: listingId,
      payload: {
        listing_id: listingId,
        owner_id: listing.owner_id,
        moderator_id: auth.user.id,
        review_id: review.id,
        edit_revision_id: open.id,
        edit_revision_no: open.revision,
        reason_code: input.reasonCode,
        cleanup_candidate_paths: cleanupPaths.join(","),
      },
    });

    if (input.decision === "APPROVED") {
      // G: the ONLY reactivation path — the central finalizer with all
      // gates re-checked (request, deactivated, ACTIVE, time-valid, no
      // open revision) under the already-held listing lock
      const fresh = await lockListingForLifecycle(tx, listingId);
      const finalize = await tryFinalizeSellerReactivation(tx, fresh!);
      reactivated = finalize.finalized;
      const after = await lockListingForLifecycle(tx, listingId);
      finalListing = { id: listingId, status: after!.status, revision: after!.revision };
    }

    await releaseClaim(tx, claim.id);
    return toResult(finalListing, decided, review, reactivated);
  });
}

export function approveEditRevision(
  auth: AuthContext,
  listingId: string,
  expectedEditRevision: number,
): Promise<EditDecisionResultDto> {
  return decideEdit(auth, listingId, {
    expectedEditRevision,
    decision: "APPROVED",
    reasonCode: null,
    note: null,
  });
}

export function rejectEditRevision(
  auth: AuthContext,
  listingId: string,
  input: { expectedEditRevision: number; reasonCode: string; note: string | null },
): Promise<EditDecisionResultDto> {
  return decideEdit(auth, listingId, {
    expectedEditRevision: input.expectedEditRevision,
    decision: "REJECTED",
    reasonCode: input.reasonCode,
    note: input.note,
  });
}

export function requestEditCorrection(
  auth: AuthContext,
  listingId: string,
  input: { expectedEditRevision: number; reasonCode: string; note: string | null },
): Promise<EditDecisionResultDto> {
  return decideEdit(auth, listingId, {
    expectedEditRevision: input.expectedEditRevision,
    decision: "CORRECTION_REQUIRED",
    reasonCode: input.reasonCode,
    note: input.note,
  });
}
