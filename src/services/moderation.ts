import type { AuthContext } from "@/auth/current-user";
import { maskPhone } from "@/auth/phone";
import { ApiError } from "@/lib/api/errors";
import { listingImageConfig } from "@/lib/config/listing-images";
import { moderationConfig } from "@/lib/config/moderation";
import { getSql, withTransaction, type Sql } from "@/lib/server/db/client";
import { getStorageProvider } from "@/providers/storage/factory";
import { listListingImages } from "@/repositories/listing-images";
import { getOpenEditRevision } from "@/repositories/listing-edit-revisions";
import { listAdjustmentAuditEvents, lockOpenAdjustment } from "@/repositories/moderation-adjustments";
import { approvedSide, getEditReviewFor } from "@/services/moderation-edit";
import {
  applyAdjustmentOnNewApproval,
  discardAdjustmentOnDecision,
  getAdjustmentViewFor,
} from "@/services/moderation-adjustments";
import { buildEditSnapshot } from "@/services/listing-lifecycle";
import { getSubmissionSettings, insertOutboxEvent, insertStatusHistory } from "@/repositories/listing-publications";
import { insertModerationAudit } from "@/repositories/moderation-audit";
import { getListingFeatureIds } from "@/repositories/listings";
import {
  activateListing,
  extendClaim,
  findMatchingReview,
  getModerationListing,
  getUnreleasedClaim,
  getValidityDays,
  insertClaim,
  insertListingPeriod,
  insertReview,
  listModerationQueue,
  listReviews,
  lockListingForModeration,
  nextPeriodNumber,
  releaseClaim,
  transitionFromPendingModeration,
  type ClaimRow,
  type ReviewRow,
} from "@/repositories/moderation";
import { toListingImageDto, type ListingImageDto } from "@/services/listing-dto";
import { buildFeatureGroups } from "@/services/moderation-content";

/**
 * Moderation service: oldest-first queue, soft claims, and the three
 * decision commands. Every decision runs in ONE transaction with the
 * listing row locked: status PENDING_MODERATION → revision =
 * expected_revision → live claim owned by the actor (strict policy
 * for ALL staff roles, no override) → review row → transition (+
 * activation effects on approve) → status history → outbox → claim
 * released. Retries that find the listing already decided return the
 * existing decision only when an identical review (same revision,
 * moderator, decision) exists — never duplicate side effects.
 */

// --- DTOs -------------------------------------------------------------------

export interface ClaimDto {
  moderatorId: string;
  expiresAt: string;
}

export interface QueueItemDto {
  id: string;
  publicId: string;
  /** O.12: what awaits review — NEW listing or an edit revision. */
  type: "NEW_LISTING" | "LISTING_EDIT";
  category: string;
  brandName: string | null;
  modelName: string | null;
  year: number | null;
  priceMinor: number | null;
  cityName: string | null;
  submittedAt: string;
  revision: number;
  seller: { id: string; phoneMasked: string; displayName: string | null };
  primaryImageUrl: string | null;
  claim: ClaimDto | null;
}

export interface ReviewDto {
  id: string;
  moderatorId: string;
  listingRevision: number;
  decision: ReviewRow["decision"];
  reasonCode: string | null;
  note: string | null;
  reviewedAt: string;
}

export interface DecisionResultDto {
  listing: { id: string; status: string; revision: number };
  review: ReviewDto;
  activation: { publishedAt: string; currentExpiresAt: string; periodNumber: number } | null;
}

function toClaimDto(claim: ClaimRow | undefined): ClaimDto | null {
  if (claim === undefined || claim.released_at !== null || claim.expires_at.getTime() <= Date.now()) {
    return null;
  }
  return { moderatorId: claim.moderator_id, expiresAt: claim.expires_at.toISOString() };
}

function toReviewDto(row: ReviewRow): ReviewDto {
  return {
    id: row.id,
    moderatorId: row.moderator_id,
    listingRevision: row.listing_revision,
    decision: row.decision,
    reasonCode: row.reason_code,
    note: row.note,
    reviewedAt: row.reviewed_at.toISOString(),
  };
}

// --- queue ------------------------------------------------------------------

// Keyset cursor = full-precision submitted_at text + id (microsecond
// precision must survive the round trip or boundary rows repeat).
function encodeCursor(submittedAtCursor: string, id: string): string {
  return Buffer.from(`${submittedAtCursor}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { submittedAt: string; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const [ts, id] = decoded.split("|");
  if (
    ts === undefined ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/.test(ts) ||
    !/^[0-9a-f-]{36}$/.test(id ?? "")
  ) {
    throw new ApiError("VALIDATION_ERROR", "Invalid cursor.");
  }
  return { submittedAt: ts, id: id! };
}

export async function getModerationQueue(input: {
  limit: number;
  cursor?: string;
}): Promise<{ items: QueueItemDto[]; nextCursor: string | null }> {
  const sql = getSql();
  const config = listingImageConfig();
  const storage = getStorageProvider();
  const after = input.cursor === undefined ? null : decodeCursor(input.cursor);
  const rows = await listModerationQueue(sql, {
    limit: input.limit + 1,
    after,
  });
  const page = rows.slice(0, input.limit);
  const items: QueueItemDto[] = [];
  for (const row of page) {
    items.push({
      id: row.id,
      publicId: row.public_id,
      type: row.moderation_type,
      category: row.category_code,
      brandName: row.brand_name,
      modelName: row.model_name,
      year: row.year,
      priceMinor: row.price_minor === null ? null : Number(row.price_minor),
      cityName: row.city_name,
      submittedAt: row.submitted_at.toISOString(),
      revision: row.revision,
      seller: {
        id: row.owner_id,
        phoneMasked: maskPhone(row.owner_phone),
        displayName: row.owner_display_name,
      },
      // Image signing failures degrade to null (same strategy as the
      // public read model) — one broken object must not take the whole
      // moderation queue down. Authorization is unaffected.
      primaryImageUrl:
        row.primary_image_path === null
          ? null
          : await storage
              .createSignedReadUrl(
                config.imagesBucket,
                row.primary_image_path,
                config.signedReadTtlSeconds,
              )
              .catch(() => null),
      claim:
        row.claim_moderator_id === null || row.claim_expires_at === null
          ? null
          : { moderatorId: row.claim_moderator_id, expiresAt: row.claim_expires_at.toISOString() },
    });
  }
  const last = page[page.length - 1];
  return {
    items,
    // keyset continues from the union tiebreaker (listing id for NEW
    // rows — byte-identical cursors to the pre-O.12 queue)
    nextCursor: rows.length > input.limit && last !== undefined
      ? encodeCursor(last.submitted_at_cursor, last.sort_id)
      : null,
  };
}

// --- detail -----------------------------------------------------------------

export async function getModerationDetail(listingId: string): Promise<Record<string, unknown>> {
  const sql = getSql();
  const row = await getModerationListing(sql, listingId);
  if (row === undefined) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  const [imageRows, featureIds, reviews, claim] = await Promise.all([
    listListingImages(sql, listingId),
    getListingFeatureIds(sql, listingId),
    listReviews(sql, listingId),
    getUnreleasedClaim(sql, listingId),
  ]);
  const images: ListingImageDto[] = [];
  for (const image of imageRows) {
    images.push(await toListingImageDto(image));
  }
  const editReview = await getEditReviewFor(listingId);
  // O.13 Stage B: the raw working base for the moderator edit mode —
  // for NEW the pending listing content, for LISTING_EDIT the pending
  // revision content (this is exactly what a first save will freeze;
  // authoritative freezing happens server-side inside the save tx).
  let adjustmentContext: {
    subject: {
      type: "NEW_LISTING" | "LISTING_EDIT";
      listingRevision: number;
      editRevisionId: string | null;
      editRevisionNo: number | null;
    };
    baseContent: Record<string, unknown>;
    imageMin: number;
  } | null = null;
  const imageMin = (await getSubmissionSettings(sql))?.imageMin ?? 3;
  if (editReview !== null) {
    const open = await getOpenEditRevision(sql, listingId);
    if (open !== undefined && open.status === "PENDING_MODERATION") {
      adjustmentContext = {
        subject: {
          type: "LISTING_EDIT",
          listingRevision: row.revision,
          editRevisionId: open.id,
          editRevisionNo: open.revision,
        },
        baseContent: open.data,
        imageMin,
      };
    }
  } else if (row.status === "PENDING_MODERATION") {
    const raw = await approvedSide(sql, listingId);
    if (raw !== undefined) {
      adjustmentContext = {
        subject: {
          type: "NEW_LISTING",
          listingRevision: row.revision,
          editRevisionId: null,
          editRevisionNo: null,
        },
        baseContent: buildEditSnapshot(raw, featureIds),
        imageMin,
      };
    }
  }
  return {
    id: row.id,
    publicId: row.public_id,
    status: row.status,
    revision: row.revision,
    category: row.category_code,
    brand: row.brand_id === null ? null : { id: row.brand_id, name: row.brand_name },
    model: row.model_id === null ? null : { id: row.model_id, name: row.model_name },
    year: row.year,
    priceMinor: row.price_minor === null ? null : Number(row.price_minor),
    currency: row.currency,
    mileage: row.mileage,
    engineCc: row.engine_cc,
    fuelType: row.fuel_type,
    transmission: row.transmission,
    bodyType: row.body_type,
    driveType: row.drive_type,
    motorcycleType: row.motorcycle_type,
    color: row.color,
    cityName: row.city_name,
    creditAvailable: row.credit_available,
    noAccident: row.no_accident,
    notRepainted: row.not_repainted,
    barterAvailable: row.barter_available,
    description: row.description,
    contactPhone: row.contact_phone_e164,
    sellerName: row.seller_name,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    publishedAt: row.published_at?.toISOString() ?? null,
    currentExpiresAt: row.current_expires_at?.toISOString() ?? null,
    seller: {
      id: row.owner_id,
      phoneMasked: maskPhone(row.owner_phone),
      displayName: row.owner_display_name,
      status: row.owner_status,
    },
    featureIds,
    // O.13 Stage A: full equipment resolved + grouped server-side
    // (O.11 groups) — the review UI renders names, never ids
    featureGroups: await buildFeatureGroups(sql, featureIds),
    images,
    reviews: reviews.map(toReviewDto),
    claim: toClaimDto(claim),
    // O.12: server-computed changed-first comparison when a pending
    // edit revision awaits review (null otherwise)
    editReview,
    // O.13 Stage B: the OPEN private adjustment (null when none —
    // never faked) + the raw edit-mode base for the current subject
    adjustment: await getAdjustmentViewFor(listingId),
    adjustmentContext,
    // O.13 Stage B: append-only save/discard lineage for the compact
    // history (survives discard — actor + timestamp, correction G/H)
    adjustmentEvents: (await listAdjustmentAuditEvents(sql, listingId)).map((event) => ({
      action: event.action,
      actorName: event.actor_display_name,
      at: event.created_at.toISOString(),
    })),
    createdAt: row.created_at.toISOString(),
  };
}

// --- claims -----------------------------------------------------------------

export async function claimListing(auth: AuthContext, listingId: string): Promise<ClaimDto> {
  const { claimTtlSeconds } = moderationConfig();
  return withTransaction(async (tx) => {
    const listing = await lockListingForModeration(tx, listingId);
    if (listing === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    if (listing.status !== "PENDING_MODERATION") {
      // O.12: the SAME claim (still keyed by listing_id) also
      // serializes LISTING_EDIT reviews — a pending edit revision makes
      // the listing claimable while its status stays ACTIVE/EXPIRED.
      const pendingEdit = await getOpenEditRevision(tx, listingId);
      if (pendingEdit === undefined || pendingEdit.status !== "PENDING_MODERATION") {
        throw new ApiError("MODERATION_INVALID_STATE", "Listing is not awaiting moderation.", {
          details: { status: listing.status },
        });
      }
    }
    const expiresAt = new Date(Date.now() + claimTtlSeconds * 1000);
    const existing = await getUnreleasedClaim(tx, listingId);
    if (existing !== undefined) {
      const live = existing.expires_at.getTime() > Date.now();
      if (live && existing.moderator_id === auth.user.id) {
        const extended = await extendClaim(tx, existing.id, expiresAt);
        return { moderatorId: extended.moderator_id, expiresAt: extended.expires_at.toISOString() };
      }
      if (live) {
        throw new ApiError("MODERATION_CLAIMED_BY_OTHER", "Another moderator holds a live claim.", {
          details: { expires_at: existing.expires_at.toISOString() },
        });
      }
      await releaseClaim(tx, existing.id); // expired → free the unique slot
    }
    const claim = await insertClaim(tx, { listingId, moderatorId: auth.user.id, expiresAt });
    return { moderatorId: claim.moderator_id, expiresAt: claim.expires_at.toISOString() };
  });
}

// --- decisions --------------------------------------------------------------

type Decision = ReviewRow["decision"];

async function requireOwnedLiveClaim(tx: Sql, listingId: string, moderatorId: string): Promise<ClaimRow> {
  const claim = await getUnreleasedClaim(tx, listingId);
  if (claim === undefined || claim.expires_at.getTime() <= Date.now()) {
    throw new ApiError("MODERATION_CLAIM_REQUIRED", "Claim the listing before deciding.");
  }
  if (claim.moderator_id !== moderatorId) {
    throw new ApiError("MODERATION_CLAIMED_BY_OTHER", "Another moderator holds the claim.");
  }
  return claim;
}

async function decide(
  auth: AuthContext,
  listingId: string,
  input: {
    expectedRevision: number;
    decision: Decision;
    reasonCode: string | null;
    note: string | null;
    /** O.13 Stage C: which adjustment version the moderator decided —
        REQUIRED to match when an OPEN adjustment exists (a newer save
        by another moderator blocks a stale decision). */
    expectedAdjustmentRevision?: number;
  },
): Promise<DecisionResultDto> {
  return withTransaction(async (tx) => {
    const listing = await lockListingForModeration(tx, listingId);
    if (listing === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }

    if (listing.status !== "PENDING_MODERATION") {
      // Idempotent retry: identical decision already committed.
      const existing = await findMatchingReview(tx, {
        listingId,
        moderatorId: auth.user.id,
        listingRevision: input.expectedRevision,
        decision: input.decision,
      });
      if (existing !== undefined) {
        const activation =
          input.decision === "APPROVED" && listing.published_at !== null
            ? await currentActivation(tx, listingId)
            : null;
        return {
          listing: { id: listing.id, status: listing.status, revision: listing.revision },
          review: toReviewDto(existing),
          activation,
        };
      }
      throw new ApiError("MODERATION_INVALID_STATE", "Listing is not awaiting moderation.", {
        details: { status: listing.status },
      });
    }
    if (listing.revision !== input.expectedRevision) {
      throw new ApiError(
        "LISTING_REVISION_CONFLICT",
        "The listing changed since it was reviewed. Reload and re-review.",
        { details: { current_revision: listing.revision } },
      );
    }
    const claim = await requireOwnedLiveClaim(tx, listingId, auth.user.id);
    // O.13 Stage C — adjustment-aware NEW decisions. Sealed lock order:
    // listing (held) → adjustment. With NO open adjustment the whole
    // path below is byte-identical to the pre-O.13 behavior.
    const openAdjustment = await lockOpenAdjustment(tx, listingId);
    if (openAdjustment !== undefined) {
      if (openAdjustment.edit_revision_id !== null) {
        // impossible by construction for a PENDING listing; defensive —
        // EDIT-subject adjustments stay Stage-B-blocked until Stage D
        throw new ApiError(
          "MODERATION_ADJUSTMENT_PENDING",
          "A saved moderator adjustment exists; adjusted decisions are not enabled yet.",
          { details: { adjustment_id: openAdjustment.id } },
        );
      }
      if (openAdjustment.submitted_listing_revision !== listing.revision) {
        throw new ApiError(
          "MODERATION_SUBJECT_CHANGED",
          "The saved adjustment belongs to a previous moderation pass.",
          { details: { adjustment_id: openAdjustment.id } },
        );
      }
      if (input.expectedAdjustmentRevision !== openAdjustment.revision) {
        throw new ApiError(
          "MODERATION_ADJUSTMENT_CONFLICT",
          "The adjustment changed since it was reviewed. Reload and re-review.",
          { details: { current_revision: openAdjustment.revision } },
        );
      }
    } else if (input.expectedAdjustmentRevision !== undefined) {
      // the client decided over an adjustment that no longer exists
      throw new ApiError(
        "MODERATION_ADJUSTMENT_CONFLICT",
        "The adjustment no longer exists. Reload and re-review.",
        { details: { current_revision: null } },
      );
    }

    const review = await insertReview(tx, {
      listingId,
      moderatorId: auth.user.id,
      listingRevision: listing.revision,
      decision: input.decision,
      reasonCode: input.reasonCode,
      note: input.note,
      adjustmentId: openAdjustment?.id ?? null,
      adjustmentRevision: openAdjustment?.revision ?? null,
    });

    let activation: DecisionResultDto["activation"] = null;
    let toStatus: "ACTIVE" | "REJECTED" | "CORRECTION_REQUIRED";
    let eventType: string;
    if (input.decision === "APPROVED") {
      // adjusted approval: the saved moderator content becomes the
      // approved content FIRST (atomically, one revision bump), then
      // the unchanged activation lifecycle runs against the new
      // revision. Without an adjustment nothing here changes.
      let activationExpectedRevision = listing.revision;
      if (openAdjustment !== undefined) {
        const applied = await applyAdjustmentOnNewApproval(tx, {
          listing: { id: listing.id, owner_id: listing.owner_id, revision: listing.revision },
          adjustment: openAdjustment,
          moderatorId: auth.user.id,
        });
        activationExpectedRevision = applied.newListingRevision;
      }
      const validityDays = await getValidityDays(tx);
      if (validityDays === null) {
        throw new ApiError("LISTING_CONFIGURATION_ERROR", "Listing validity is not configured.");
      }
      const activatedAt = new Date();
      const expiresAt = new Date(activatedAt.getTime() + validityDays * 86_400_000);
      const periodNumber = await nextPeriodNumber(tx, listingId);
      await insertListingPeriod(tx, {
        listingId,
        periodNumber,
        source: periodNumber === 1 ? "INITIAL" : "RENEWAL",
        startsAt: activatedAt,
        endsAt: expiresAt,
      });
      const ok = await activateListing(tx, {
        listingId,
        expectedRevision: activationExpectedRevision,
        activatedAt,
        expiresAt,
      });
      if (!ok) throw new ApiError("MODERATION_INVALID_STATE", "Listing changed during approval.");
      toStatus = "ACTIVE";
      eventType = "LISTING_ACTIVATED";
      activation = {
        publishedAt: (listing.published_at ?? activatedAt).toISOString(),
        currentExpiresAt: expiresAt.toISOString(),
        periodNumber,
      };
    } else {
      toStatus = input.decision === "REJECTED" ? "REJECTED" : "CORRECTION_REQUIRED";
      eventType = input.decision === "REJECTED" ? "LISTING_REJECTED" : "LISTING_CORRECTION_REQUESTED";
      const ok = await transitionFromPendingModeration(tx, {
        listingId,
        expectedRevision: listing.revision,
        toStatus,
      });
      if (!ok) throw new ApiError("MODERATION_INVALID_STATE", "Listing changed during decision.");
      if (openAdjustment !== undefined) {
        // sealed NEW behavior: correction/reject apply NOTHING — seller
        // content is untouched, the adjustment becomes terminal
        // DISCARDED (retained history; the next pass starts clean)
        await discardAdjustmentOnDecision(tx, {
          listingId,
          adjustment: openAdjustment,
          actorUserId: auth.user.id,
          decision: input.decision,
        });
      }
    }

    await insertStatusHistory(tx, {
      listingId,
      fromStatus: "PENDING_MODERATION",
      toStatus,
      actorUserId: auth.user.id,
      reasonCode: input.reasonCode ?? `MODERATION_${input.decision}`,
    });
    await insertOutboxEvent(tx, {
      eventType,
      aggregateId: listingId,
      payload: {
        listing_id: listingId,
        owner_id: listing.owner_id,
        moderator_id: auth.user.id,
        review_id: review.id,
        listing_revision: listing.revision,
        reason_code: input.reasonCode,
        current_expires_at: activation?.currentExpiresAt ?? null,
      },
    });
    await releaseClaim(tx, claim.id);

    return {
      listing: { id: listing.id, status: toStatus, revision: listing.revision },
      review: toReviewDto(review),
      activation,
    };
  });
}

async function currentActivation(
  tx: Sql,
  listingId: string,
): Promise<DecisionResultDto["activation"]> {
  const rows = await tx<{ published_at: Date; current_expires_at: Date; period_number: number }[]>`
    select l.published_at, l.current_expires_at, p.period_number
    from listings l
    join listing_periods p on p.listing_id = l.id
    where l.id = ${listingId}
    order by p.period_number desc limit 1
  `;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        publishedAt: row.published_at.toISOString(),
        currentExpiresAt: row.current_expires_at.toISOString(),
        periodNumber: row.period_number,
      };
}

export function approveListing(
  auth: AuthContext,
  listingId: string,
  expectedRevision: number,
  expectedAdjustmentRevision?: number,
) {
  return decide(auth, listingId, {
    expectedRevision,
    decision: "APPROVED",
    reasonCode: null,
    note: null,
    expectedAdjustmentRevision,
  });
}

export function rejectListing(
  auth: AuthContext,
  listingId: string,
  input: {
    expectedRevision: number;
    reasonCode: string;
    note: string | null;
    expectedAdjustmentRevision?: number;
  },
) {
  return decide(auth, listingId, { ...input, decision: "REJECTED" });
}

export function requestCorrection(
  auth: AuthContext,
  listingId: string,
  input: {
    expectedRevision: number;
    reasonCode: string;
    note: string | null;
    expectedAdjustmentRevision?: number;
  },
) {
  return decide(auth, listingId, { ...input, decision: "CORRECTION_REQUESTED" });
}

export interface SuspensionResultDto {
  listing: { id: string; status: string; revision: number };
}

/**
 * Staff suspension of a publicly ACTIVE listing (accepted moderator
 * capability; Phase 4.14 adds the missing command). Queue claims are
 * PENDING_MODERATION coordination and do not apply here — the guards
 * are staff RBAC, the listing row lock, and expected_revision.
 * Effects: listing hidden publicly (status alone removes it from
 * every publicVisible() read), MODERATOR status history, append-only
 * audit entry, outbox event. Paid listing/promotion time is NOT
 * touched and nothing is refunded — promotion periods simply stop
 * being publicly effective while hidden (accepted lifecycle rules).
 * Idempotent retry: an already SUSPENDED listing returns the current
 * state instead of double-writing history.
 */
export async function suspendListing(
  auth: AuthContext,
  listingId: string,
  input: { expectedRevision: number; reasonCode: string; note: string | null },
): Promise<SuspensionResultDto> {
  return withTransaction(async (tx) => {
    const listing = await lockListingForModeration(tx, listingId);
    if (listing === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    if (listing.status === "SUSPENDED") {
      return { listing: { id: listing.id, status: listing.status, revision: listing.revision } };
    }
    if (listing.status !== "ACTIVE") {
      throw new ApiError("MODERATION_INVALID_STATE", "Only active listings can be suspended.", {
        details: { current_status: listing.status },
      });
    }
    if (listing.revision !== input.expectedRevision) {
      throw new ApiError("LISTING_REVISION_CONFLICT", "The listing changed during review.", {
        details: { current_revision: listing.revision },
      });
    }
    await tx`update listings set status = 'SUSPENDED' where id = ${listingId}`;
    await insertStatusHistory(tx, {
      listingId,
      fromStatus: "ACTIVE",
      toStatus: "SUSPENDED",
      actorUserId: auth.user.id,
      reasonCode: input.reasonCode,
    });
    await insertModerationAudit(tx, {
      actorUserId: auth.user.id,
      action: "LISTING_SUSPENDED",
      entityId: listingId,
      afterData: { status: "SUSPENDED", reason_code: input.reasonCode, note: input.note },
    });
    await insertOutboxEvent(tx, {
      eventType: "LISTING_SUSPENDED",
      aggregateId: listingId,
      payload: { listing_id: listingId, reason_code: input.reasonCode },
    });
    return { listing: { id: listingId, status: "SUSPENDED", revision: listing.revision } };
  });
}
