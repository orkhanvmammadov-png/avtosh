import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { withTransaction, type Sql } from "@/lib/server/db/client";
import {
  clearReactivationRequest,
  clearSellerDeactivation,
  lockListingForLifecycle,
  lockOwnedListingForLifecycle,
  markSellerDeactivated,
  recordReactivationRequest,
  type LifecycleListingRow,
} from "@/repositories/listing-lifecycle";
import {
  cancelEditRevision,
  getOpenEditRevision,
  insertEditRevision,
  listEditRevisionImages,
  lockOpenEditRevision,
  snapshotApprovedImages,
  type EditRevisionRow,
} from "@/repositories/listing-edit-revisions";
import { getListingFeatureIds } from "@/repositories/listings";
import { insertOutboxEvent } from "@/repositories/listing-publications";
import { insertSellerAudit } from "@/repositories/seller-audit";

/**
 * O.12 Stage A — seller listing lifecycle core (deactivate /
 * reactivation intent / central finalizer / edit-revision
 * create-or-get / cancel). Sealed invariants:
 *
 * - visibility (seller_deactivated_at) is orthogonal to status: expiry,
 *   renewal, suspension and moderation keep operating on status alone
 * - ONLY tryFinalizeSellerReactivation clears seller_deactivated_at
 * - edit revisions are content-only children: no quota, no fee, no
 *   publication periods, no promotion interaction, no status writes
 * - lock order everywhere: listing row FIRST, open revision second.
 */

/** Editable snapshot field space == the validated seller draft-PATCH
    contract (promotion-intent fields are sealed OUT of edit scope;
    lifecycle fields never enter revision.data). */
export function buildEditSnapshot(
  listing: LifecycleListingRow,
  featureIds: string[],
): Record<string, unknown> {
  return {
    category: listing.category_code,
    brand_id: listing.brand_id,
    model_id: listing.model_id,
    model_variant_id: listing.model_variant_id,
    year: listing.year,
    price_minor: listing.price_minor === null ? null : Number(listing.price_minor),
    mileage: listing.mileage,
    engine_cc: listing.engine_cc,
    fuel_type_id: listing.fuel_type_id,
    transmission_id: listing.transmission_id,
    body_type_id: listing.body_type_id,
    drive_type_id: listing.drive_type_id,
    motorcycle_type_id: listing.motorcycle_type_id,
    color_id: listing.color_id,
    city_id: listing.city_id,
    credit_available: listing.credit_available,
    barter_available: listing.barter_available,
    no_accident: listing.no_accident === true ? true : null,
    not_repainted: listing.not_repainted === true ? true : null,
    description: listing.description,
    contact_phone: listing.contact_phone_e164,
    seller_name: listing.seller_name,
    feature_ids: featureIds,
  };
}

function assertLifecycleVisible(listing: LifecycleListingRow | undefined): LifecycleListingRow {
  if (listing === undefined || listing.deleted_at !== null || listing.status === "DELETED") {
    // DELETED shares the uniform anti-oracle path.
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  return listing;
}

const EDITABLE_LIFECYCLE_STATUSES = ["ACTIVE", "EXPIRED"] as const;

export interface EditRevisionDto {
  id: string;
  listingId: string;
  status: string;
  data: Record<string, unknown>;
  revision: number;
  submittedAt: string | null;
  imageCount: number;
}

function toRevisionDto(row: EditRevisionRow, imageCount: number): EditRevisionDto {
  return {
    id: row.id,
    listingId: row.listing_id,
    status: row.status,
    data: row.data,
    revision: row.revision,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    imageCount,
  };
}

/**
 * Create-or-get THE open edit revision. Creation snapshots the full
 * approved content (scalars + feature_ids into data; approved gallery
 * as staged row copies). Concurrency: the partial unique index is the
 * arbiter — a lost insert race re-selects the winner, so two
 * concurrent callers converge on one revision.
 */
export async function getOrCreateEditRevision(
  auth: AuthContext,
  listingId: string,
): Promise<EditRevisionDto> {
  return withTransaction(async (tx) => {
    const listing = assertLifecycleVisible(
      await lockOwnedListingForLifecycle(tx, listingId, auth.user.id),
    );
    if (!(EDITABLE_LIFECYCLE_STATUSES as readonly string[]).includes(listing.status)) {
      throw new ApiError(
        "LISTING_LIFECYCLE_CONFLICT",
        "Editing is available only for published or expired listings.",
        { details: { status: listing.status } },
      );
    }
    const existing = await lockOpenEditRevision(tx, listingId);
    if (existing !== undefined) {
      const images = await listEditRevisionImages(tx, existing.id);
      return toRevisionDto(existing, images.length);
    }
    const featureIds = await getListingFeatureIds(tx, listingId);
    const inserted = await insertEditRevision(tx, {
      listingId,
      data: buildEditSnapshot(listing, featureIds),
    });
    if (inserted === null) {
      // lost the unique-index race — the concurrent winner is the revision
      const winner = await lockOpenEditRevision(tx, listingId);
      if (winner === undefined) {
        throw new ApiError("INTERNAL_ERROR", "Edit revision creation raced unexpectedly.");
      }
      const images = await listEditRevisionImages(tx, winner.id);
      return toRevisionDto(winner, images.length);
    }
    const copied = await snapshotApprovedImages(tx, { listingId, revisionId: inserted.id });
    await insertSellerAudit(tx, {
      actorUserId: auth.user.id,
      action: "LISTING_EDIT_REVISION_CREATED",
      entityId: listingId,
      afterData: { edit_revision_id: inserted.id, staged_images: copied },
    });
    await insertOutboxEvent(tx, {
      eventType: "LISTING_EDIT_REVISION_CREATED",
      aggregateId: listingId,
      payload: { listing_id: listingId, edit_revision_id: inserted.id },
    });
    return toRevisionDto(inserted, copied);
  });
}

/**
 * Cancel THE open revision. Allowed from EDIT_DRAFT and
 * CORRECTION_REQUIRED only — PENDING_MODERATION is a typed conflict.
 * History is preserved (terminal CANCELLED, never deletion); a
 * dependent reactivation request is cleared; staged uploads become
 * cleanup candidates via outbox (reference-checked later — storage
 * objects shared with the approved gallery are never deletable).
 */
export async function cancelOpenEditRevision(
  auth: AuthContext,
  listingId: string,
  expectedEditRevision: number,
): Promise<{ revisionId: string; status: string }> {
  return withTransaction(async (tx) => {
    const listing = assertLifecycleVisible(
      await lockOwnedListingForLifecycle(tx, listingId, auth.user.id),
    );
    const open = await lockOpenEditRevision(tx, listingId);
    if (open === undefined) {
      throw new ApiError("LISTING_LIFECYCLE_CONFLICT", "No open edit revision to cancel.");
    }
    if (open.status === "PENDING_MODERATION") {
      throw new ApiError(
        "LISTING_LIFECYCLE_CONFLICT",
        "An edit under moderation cannot be cancelled.",
        { details: { edit_status: open.status } },
      );
    }
    const cancelled = await cancelEditRevision(tx, {
      revisionId: open.id,
      expectedRevision: expectedEditRevision,
    });
    if (cancelled === undefined) {
      throw new ApiError(
        "LISTING_REVISION_CONFLICT",
        "The edit changed since it was loaded. Reload and retry.",
        { details: { current_revision: open.revision } },
      );
    }
    // the activation vehicle is gone — never let a stale request
    // publish anything later
    await clearReactivationRequest(tx, listingId);
    const staged = await listEditRevisionImages(tx, open.id);
    await insertSellerAudit(tx, {
      actorUserId: auth.user.id,
      action: "LISTING_EDIT_CANCELLED",
      entityId: listingId,
      afterData: { edit_revision_id: open.id },
    });
    await insertOutboxEvent(tx, {
      eventType: "LISTING_EDIT_CANCELLED",
      aggregateId: listingId,
      payload: {
        listing_id: listingId,
        edit_revision_id: open.id,
        // cleanup CANDIDATES only: a future reference-checking worker
        // may delete an object ONLY when neither listing_images nor
        // listing_edit_images still references it
        cleanup_candidate_paths: staged.map((img) => img.storage_path).join(","),
      },
    });
    void listing;
    return { revisionId: cancelled.id, status: cancelled.status };
  });
}

export interface DeactivationResult {
  listingId: string;
  sellerDeactivatedAt: string;
  revision: number;
  alreadyDeactivated: boolean;
}

/**
 * Seller deactivation: hides the listing from every fresh public read
 * while validity and promotion clocks keep running. Idempotent —
 * repeating the action returns the existing state (the suspend-service
 * idempotency convention).
 */
export async function deactivateListing(
  auth: AuthContext,
  listingId: string,
  expectedRevision: number,
): Promise<DeactivationResult> {
  return withTransaction(async (tx) => {
    const listing = assertLifecycleVisible(
      await lockOwnedListingForLifecycle(tx, listingId, auth.user.id),
    );
    if (listing.seller_deactivated_at !== null) {
      return {
        listingId,
        sellerDeactivatedAt: listing.seller_deactivated_at.toISOString(),
        revision: listing.revision,
        alreadyDeactivated: true,
      };
    }
    if (listing.status !== "ACTIVE") {
      throw new ApiError(
        "LISTING_LIFECYCLE_CONFLICT",
        "Only active listings can be deactivated.",
        { details: { status: listing.status } },
      );
    }
    if (listing.revision !== expectedRevision) {
      throw new ApiError(
        "LISTING_REVISION_CONFLICT",
        "The listing changed in another session. Reload and retry.",
        { details: { current_revision: listing.revision } },
      );
    }
    const changed = await markSellerDeactivated(tx, { listingId, expectedRevision });
    if (!changed) {
      throw new ApiError("LISTING_REVISION_CONFLICT", "The listing changed during deactivation.");
    }
    await insertSellerAudit(tx, {
      actorUserId: auth.user.id,
      action: "LISTING_SELLER_DEACTIVATED",
      entityId: listingId,
      afterData: { seller_deactivated: true },
    });
    await insertOutboxEvent(tx, {
      eventType: "LISTING_SELLER_DEACTIVATED",
      aggregateId: listingId,
      payload: { listing_id: listingId, user_id: auth.user.id },
    });
    const fresh = await lockOwnedListingForLifecycle(tx, listingId, auth.user.id);
    return {
      listingId,
      sellerDeactivatedAt: fresh!.seller_deactivated_at!.toISOString(),
      revision: fresh!.revision,
      alreadyDeactivated: false,
    };
  });
}

export type ReactivationBlockReason =
  | "NOT_REQUESTED"
  | "NOT_DEACTIVATED"
  | "STATUS_NOT_ACTIVE"
  | "EXPIRED"
  | "OPEN_EDIT_REVISION";

export interface FinalizeResult {
  finalized: boolean;
  reason: ReactivationBlockReason | null;
}

/**
 * THE central reactivation finalizer — the ONLY code that clears
 * seller_deactivated_at. Runs inside the caller's transaction with the
 * listing row already locked (lock order: listing first, revision
 * lookup second). Callers today: the reactivate service; later stages:
 * edit approval (Stage D) and renewal fulfillment (Stage E).
 */
export async function tryFinalizeSellerReactivation(
  tx: Sql,
  listing: LifecycleListingRow,
): Promise<FinalizeResult> {
  if (listing.seller_reactivation_requested_at === null) {
    return { finalized: false, reason: "NOT_REQUESTED" };
  }
  if (listing.seller_deactivated_at === null) {
    return { finalized: false, reason: "NOT_DEACTIVATED" };
  }
  if (listing.status !== "ACTIVE") {
    return {
      finalized: false,
      reason: listing.status === "EXPIRED" ? "EXPIRED" : "STATUS_NOT_ACTIVE",
    };
  }
  if (listing.current_expires_at === null || listing.current_expires_at.getTime() <= Date.now()) {
    return { finalized: false, reason: "EXPIRED" };
  }
  const open = await getOpenEditRevision(tx, listing.id);
  if (open !== undefined) {
    return { finalized: false, reason: "OPEN_EDIT_REVISION" };
  }
  const cleared = await clearSellerDeactivation(tx, listing.id);
  if (!cleared) {
    // SQL-side gates re-check everything under the lock; a false here
    // means the state moved between read and write — report honestly.
    return { finalized: false, reason: "STATUS_NOT_ACTIVE" };
  }
  await insertSellerAudit(tx, {
    actorUserId: listing.owner_id,
    action: "LISTING_SELLER_REACTIVATED",
    entityId: listing.id,
    afterData: { seller_deactivated: false },
  });
  await insertOutboxEvent(tx, {
    eventType: "LISTING_SELLER_REACTIVATED",
    aggregateId: listing.id,
    payload: { listing_id: listing.id },
  });
  return { finalized: true, reason: null };
}

/** Re-lockable finalizer entry for future callers (approval/renewal)
    that hold only the listing id. */
export async function tryFinalizeSellerReactivationById(
  tx: Sql,
  listingId: string,
): Promise<FinalizeResult> {
  const listing = await lockListingForLifecycle(tx, listingId);
  if (listing === undefined) {
    return { finalized: false, reason: "NOT_DEACTIVATED" };
  }
  return tryFinalizeSellerReactivation(tx, listing);
}

export type ReactivationOutcome =
  | "REACTIVATED"
  | "AWAITING_MODERATION"
  | "CORRECTION_REQUIRED"
  | "EDIT_INCOMPLETE"
  | "RENEWAL_REQUIRED";

export interface ReactivationResult {
  listingId: string;
  outcome: ReactivationOutcome;
  reactivationRequested: boolean;
  revision: number;
}

/**
 * Seller "Aktiv et". Direct path (valid, no open edit): record the
 * request and finalize in the same transaction — no period, no fee, no
 * quota, no content writes. With an open revision the outcome routes
 * the seller instead: EDIT_DRAFT never records a request (the edit
 * must be explicitly completed and submitted); PENDING/CORRECTION
 * record the request and stay hidden until approval finalizes.
 * EXPIRED always defers to the renewal contract.
 */
export async function reactivateListing(
  auth: AuthContext,
  listingId: string,
  expectedRevision: number,
): Promise<ReactivationResult> {
  return withTransaction(async (tx) => {
    const listing = assertLifecycleVisible(
      await lockOwnedListingForLifecycle(tx, listingId, auth.user.id),
    );
    if (listing.status === "SUSPENDED") {
      throw new ApiError(
        "LISTING_LIFECYCLE_CONFLICT",
        "A suspended listing cannot be reactivated by the seller.",
        { details: { status: listing.status } },
      );
    }
    if (listing.status === "SOLD" || listing.sold_at !== null) {
      throw new ApiError(
        "LISTING_LIFECYCLE_CONFLICT",
        "A sold listing cannot be reactivated.",
        { details: { status: listing.status } },
      );
    }
    if (listing.seller_deactivated_at === null) {
      // idempotent: nothing to do, already visible-per-seller
      return {
        listingId,
        outcome: "REACTIVATED",
        reactivationRequested: false,
        revision: listing.revision,
      };
    }
    if (listing.revision !== expectedRevision) {
      throw new ApiError(
        "LISTING_REVISION_CONFLICT",
        "The listing changed in another session. Reload and retry.",
        { details: { current_revision: listing.revision } },
      );
    }
    const timeExpired =
      listing.current_expires_at === null || listing.current_expires_at.getTime() <= Date.now();
    if (listing.status === "EXPIRED" || timeExpired) {
      // renewal (2 AZN) remains the only path back to validity — the
      // fulfillment→finalizer hook arrives in Stage E
      return {
        listingId,
        outcome: "RENEWAL_REQUIRED",
        reactivationRequested: listing.seller_reactivation_requested_at !== null,
        revision: listing.revision,
      };
    }

    const open = await lockOpenEditRevision(tx, listingId);
    if (open !== undefined && open.status === "EDIT_DRAFT") {
      // never auto-submit an incomplete draft, never publish the old
      // version around it — the seller finishes the edit explicitly
      return {
        listingId,
        outcome: "EDIT_INCOMPLETE",
        reactivationRequested: false,
        revision: listing.revision,
      };
    }

    const recorded = await recordReactivationRequest(tx, {
      listingId,
      expectedRevision: listing.revision,
    });
    if (!recorded) {
      throw new ApiError("LISTING_REVISION_CONFLICT", "The listing changed during reactivation.");
    }
    if (listing.seller_reactivation_requested_at === null) {
      await insertSellerAudit(tx, {
        actorUserId: auth.user.id,
        action: "LISTING_SELLER_REACTIVATION_REQUESTED",
        entityId: listingId,
        afterData: { edit_revision_id: open?.id ?? null },
      });
    }

    if (open !== undefined) {
      return {
        listingId,
        outcome: open.status === "PENDING_MODERATION" ? "AWAITING_MODERATION" : "CORRECTION_REQUIRED",
        reactivationRequested: true,
        revision: listing.revision + 1,
      };
    }

    const fresh = await lockListingForLifecycle(tx, listingId);
    const finalize = await tryFinalizeSellerReactivation(tx, fresh!);
    if (!finalize.finalized) {
      // gates re-checked in SQL failed between read and write
      return {
        listingId,
        outcome: "RENEWAL_REQUIRED",
        reactivationRequested: true,
        revision: fresh!.revision,
      };
    }
    const after = await lockListingForLifecycle(tx, listingId);
    return {
      listingId,
      outcome: "REACTIVATED",
      reactivationRequested: false,
      revision: after!.revision,
    };
  });
}
