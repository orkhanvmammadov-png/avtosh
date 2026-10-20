import { randomUUID } from "node:crypto";
import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import { guestDraftLimits, guestDraftsEnabled } from "@/lib/config/guest-drafts";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  listingImageConfig,
} from "@/lib/config/listing-images";
import { getSql, withTransaction, type Sql } from "@/lib/server/db/client";
import {
  ImageProcessingError,
  processListingImage,
} from "@/lib/server/images/process";
import { getStorageProvider } from "@/providers/storage/factory";
import {
  clearPrimaryImage,
  completeImageUpload,
  countGuestUploadsForSessionSince,
  countListingImages,
  countPendingUploads,
  deleteListingImage,
  getGuestImageUpload,
  getGuestImageUploadForUpdate,
  getImageUpload,
  getImageUploadForUpdate,
  getListingImage,
  getListingImageMax,
  insertGuestImageUpload,
  insertImageUpload,
  insertListingImage,
  listListingImages,
  markImageUploadStatus,
  promoteNextPrimaryImage,
  setImageSortOrder,
  setPrimaryImage,
  type ImageUploadRow,
  type ListingImageRow,
} from "@/repositories/listing-images";
import {
  getGuestListing,
  getGuestListingForUpdate,
  lockActiveGuestSession,
} from "@/repositories/guest-drafts";
import {
  getOwnedListing,
  getOwnedListingForUpdate,
  incrementListingRevision,
} from "@/repositories/listings";
import { toListingImageDto, type ListingImageDto } from "@/services/listing-dto";
import { isSellerEditable } from "@/services/listing-states";

/**
 * Listing image service: signed direct-to-storage uploads, verified
 * confirmation with real image processing, ordering/primary
 * management, and deletion — all owner-scoped and DRAFT-only.
 *
 * Storage and PostgreSQL cannot share a transaction. Ordering is:
 * process → write final object → DB transaction (limits, insert,
 * revision) → best-effort temp cleanup; compensating deletes remove
 * the final object when the DB step fails. The database is the source
 * of truth — storage orphans are harmless and future-cleanup-eligible.
 *
 * Deferred-login PR B: ONE core per operation, scoped by an ImageActor
 * — the authenticated seller (unchanged contracts and signatures) or a
 * guest draft session (fail-closed behind GUEST_DRAFTS_ENABLED). Guest
 * scoping is always (cookie-derived unexpired session AND guest-owned
 * DRAFT listing); an upload or listing id alone never authorizes, and
 * foreign/expired/unknown all answer the same LISTING_NOT_FOUND. A
 * claim (PR C) or session expiry racing an in-flight confirmation is
 * safe: the final transaction's guest-scoped LOCKED lookups miss, the
 * compensating delete removes the just-written final object, and the
 * claimed listing (re-homed with its upload rows, per the migration's
 * PR C contract) is untouched.
 */

type ImageActor =
  | { kind: "user"; userId: string }
  | { kind: "guest"; sessionId: string };

const userActor = (auth: AuthContext): ImageActor => ({
  kind: "user",
  userId: auth.user.id,
});

function guestActor(session: { sessionId: string } | null): ImageActor {
  if (!guestDraftsEnabled() || session === null) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  return { kind: "guest", sessionId: session.sessionId };
}

async function requireScopedDraft(
  actor: ImageActor,
  listingId: string,
): Promise<void> {
  const sql = getSql();
  const listing =
    actor.kind === "user"
      ? await getOwnedListing(sql, listingId, actor.userId)
      : await getGuestListing(sql, listingId, actor.sessionId);
  if (listing === undefined) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  if (!isSellerEditable(listing.status)) {
    throw new ApiError(
      "LISTING_NOT_EDITABLE",
      "The listing is not editable in its current state.",
    );
  }
}

/** Locked scoped lookup (minimal shape) for the mutation transactions. */
async function getScopedListingForUpdate(
  tx: Sql,
  actor: ImageActor,
  listingId: string,
): Promise<{ id: string; status: string; revision: number } | undefined> {
  return actor.kind === "user"
    ? getOwnedListingForUpdate(tx, listingId, actor.userId)
    : getGuestListingForUpdate(tx, listingId, actor.sessionId);
}

async function getScopedUpload(
  sql: Sql,
  actor: ImageActor,
  uploadId: string,
  listingId: string,
): Promise<ImageUploadRow | undefined> {
  return actor.kind === "user"
    ? getImageUpload(sql, uploadId, listingId, actor.userId)
    : getGuestImageUpload(sql, uploadId, listingId, actor.sessionId);
}

async function getScopedUploadForUpdate(
  sql: Sql,
  actor: ImageActor,
  uploadId: string,
  listingId: string,
): Promise<ImageUploadRow | undefined> {
  return actor.kind === "user"
    ? getImageUploadForUpdate(sql, uploadId, listingId, actor.userId)
    : getGuestImageUploadForUpdate(sql, uploadId, listingId, actor.sessionId);
}

/** Server-generated temp paths — client input never reaches storage
    paths; guests get their own namespace. */
function tempPathFor(actor: ImageActor, listingId: string, uploadId: string): string {
  return actor.kind === "user"
    ? `uploads/${actor.userId}/${listingId}/${uploadId}`
    : `uploads/guest/${actor.sessionId}/${listingId}/${uploadId}`;
}

// --- upload authorization ---------------------------------------------------

export interface UploadAuthorization {
  uploadId: string;
  uploadUrl: string;
  uploadToken: string | null;
  expiresInSeconds: number;
  maxSizeBytes: number;
}

async function createUploadAuthorizationFor(
  actor: ImageActor,
  listingId: string,
  declared: { mimeType: string; sizeBytes: number },
): Promise<UploadAuthorization> {
  const config = listingImageConfig();
  await requireScopedDraft(actor, listingId);

  // Declared values are untrusted hints — real validation happens on
  // the actual bytes at confirmation — but obviously-invalid requests
  // are rejected before storage cost is incurred.
  if (
    !(ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(
      declared.mimeType,
    )
  ) {
    throw new ApiError(
      "IMAGE_INVALID_FORMAT",
      "Only JPEG, PNG, and WebP images are supported.",
    );
  }
  if (declared.sizeBytes > config.maxUploadBytes) {
    throw new ApiError(
      "IMAGE_TOO_LARGE",
      `Images must be at most ${config.maxUploadBytes} bytes.`,
    );
  }

  const uploadId = randomUUID();
  const tempPath = tempPathFor(actor, listingId, uploadId);

  await withTransaction(async (tx) => {
    // Guest issuance brake FIRST, under the session row lock
    // (documented lock order: session → listing), so parallel
    // signed-URL requests across a session's drafts serialize and the
    // per-session hourly cap holds exactly. Sellers are untouched.
    if (actor.kind === "guest") {
      const session = await lockActiveGuestSession(tx, actor.sessionId);
      if (session === undefined) {
        throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
      }
      const issued = await countGuestUploadsForSessionSince(
        tx,
        actor.sessionId,
        new Date(Date.now() - 3_600_000),
      );
      if (issued >= guestDraftLimits().uploadsPerSessionPerHour) {
        throw new ApiError(
          "IMAGE_UPLOAD_RATE_LIMITED",
          "Too many uploads. Try again later.",
        );
      }
    }
    const listing = await getScopedListingForUpdate(tx, actor, listingId);
    if (listing === undefined || !isSellerEditable(listing.status)) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    const [imageMax, imageCount, pendingCount] = [
      await getListingImageMax(tx),
      await countListingImages(tx, listingId),
      await countPendingUploads(tx, listingId),
    ];
    if (imageCount + pendingCount >= imageMax) {
      throw new ApiError(
        "LISTING_IMAGE_LIMIT_REACHED",
        `A listing can have at most ${imageMax} images.`,
      );
    }
    if (pendingCount >= config.maxPendingUploads) {
      throw new ApiError(
        "IMAGE_UPLOAD_RATE_LIMITED",
        "Too many uploads in progress. Confirm or wait for them to expire.",
      );
    }
    if (actor.kind === "user") {
      await insertImageUpload(tx, {
        id: uploadId,
        listingId,
        userId: actor.userId,
        tempStoragePath: tempPath,
        declaredMimeType: declared.mimeType,
        declaredSizeBytes: declared.sizeBytes,
        expiresAt: new Date(Date.now() + config.signedUploadTtlSeconds * 1000),
      });
    } else {
      await insertGuestImageUpload(tx, {
        id: uploadId,
        listingId,
        guestSessionId: actor.sessionId,
        tempStoragePath: tempPath,
        declaredMimeType: declared.mimeType,
        declaredSizeBytes: declared.sizeBytes,
        expiresAt: new Date(Date.now() + config.signedUploadTtlSeconds * 1000),
      });
    }
  });

  try {
    const signed = await getStorageProvider().createSignedUploadUrl(
      config.uploadsBucket,
      tempPath,
      config.signedUploadTtlSeconds,
    );
    return {
      uploadId,
      uploadUrl: signed.url,
      uploadToken: signed.token,
      expiresInSeconds: config.signedUploadTtlSeconds,
      maxSizeBytes: config.maxUploadBytes,
    };
  } catch {
    await markImageUploadStatus(getSql(), uploadId, "FAILED");
    throw new ApiError(
      "INTERNAL_ERROR",
      "Could not prepare the upload. Please try again.",
      { status: 502 },
    );
  }
}

export async function createUploadAuthorization(
  auth: AuthContext,
  listingId: string,
  declared: { mimeType: string; sizeBytes: number },
): Promise<UploadAuthorization> {
  return createUploadAuthorizationFor(userActor(auth), listingId, declared);
}

export async function createGuestUploadAuthorization(
  session: { sessionId: string } | null,
  listingId: string,
  declared: { mimeType: string; sizeBytes: number },
): Promise<UploadAuthorization> {
  return createUploadAuthorizationFor(guestActor(session), listingId, declared);
}

// --- confirmation -----------------------------------------------------------

export interface ConfirmResult {
  image: ListingImageDto;
  revision: number;
}

async function confirmUploadFor(
  actor: ImageActor,
  listingId: string,
  uploadId: string,
): Promise<ConfirmResult> {
  const config = listingImageConfig();
  const sql = getSql();
  const storage = getStorageProvider();
  await requireScopedDraft(actor, listingId);

  // Snapshot of the upload row (unlocked — the authoritative
  // idempotency/limit decisions happen inside the final transaction).
  const upload = await getScopedUpload(sql, actor, uploadId, listingId);
  if (upload === undefined) {
    throw new ApiError("IMAGE_UPLOAD_NOT_FOUND", "Upload not found.");
  }
  if (upload.status === "COMPLETED" && upload.image_id !== null) {
    const existing = await getListingImage(sql, upload.image_id, listingId);
    if (existing !== undefined) {
      const image = await toListingImageDto(existing);
      const listing =
        actor.kind === "user"
          ? await getOwnedListing(sql, listingId, actor.userId)
          : await getGuestListing(sql, listingId, actor.sessionId);
      return { image, revision: listing?.revision ?? 0 };
    }
    throw new ApiError("IMAGE_UPLOAD_NOT_FOUND", "Upload not found.");
  }
  if (upload.status === "FAILED" || upload.status === "EXPIRED") {
    throw new ApiError("IMAGE_UPLOAD_NOT_FOUND", "Upload is not usable.");
  }
  if (upload.expires_at.getTime() <= Date.now()) {
    await markImageUploadStatus(sql, uploadId, "EXPIRED");
    await deleteTempQuietly(upload.temp_storage_path);
    throw new ApiError("IMAGE_UPLOAD_EXPIRED", "The upload window has expired.");
  }

  // Fetch and validate the ACTUAL uploaded bytes.
  const original = await storage.downloadObject(
    config.uploadsBucket,
    upload.temp_storage_path,
  );
  if (original === null) {
    throw new ApiError(
      "IMAGE_UPLOAD_NOT_FOUND",
      "No uploaded file was found for this upload.",
    );
  }
  if (original.length > config.maxUploadBytes) {
    await markImageUploadStatus(sql, uploadId, "FAILED");
    await deleteTempQuietly(upload.temp_storage_path);
    throw new ApiError(
      "IMAGE_TOO_LARGE",
      `Images must be at most ${config.maxUploadBytes} bytes.`,
    );
  }

  let processed;
  try {
    processed = await processListingImage(original, {
      maxEdgePx: config.maxEdgePx,
      webpQuality: config.webpQuality,
    });
  } catch (error) {
    await markImageUploadStatus(sql, uploadId, "FAILED");
    await deleteTempQuietly(upload.temp_storage_path);
    if (error instanceof ImageProcessingError) {
      throw new ApiError(
        error.reason === "INVALID_FORMAT"
          ? "IMAGE_INVALID_FORMAT"
          : "IMAGE_PROCESSING_FAILED",
        error.message,
      );
    }
    throw new ApiError("IMAGE_PROCESSING_FAILED", "The image could not be processed.");
  }

  // Opaque, deterministic final path (image id = upload id): no owner,
  // listing, or seller identifiers in the object key — public signed
  // URLs therefore reveal nothing internal. Authorization is decided
  // by PostgreSQL ownership/state via listing_images, never by path
  // secrecy. A concurrent or retried confirm overwrites the same
  // object with identical content instead of duplicating it.
  const finalPath = `listings/${uploadId}.webp`;
  await storage.uploadObject(
    config.imagesBucket,
    finalPath,
    processed.data,
    processed.mimeType,
  );

  let imageRow: ListingImageRow;
  let revision: number;
  try {
    const result = await withTransaction(async (tx) => {
      // Guest note: these LOCKED scoped lookups are where a claim or a
      // session expiry racing this confirmation loses cleanly — the
      // guest scope misses, the catch below compensates the final
      // object, and the claimed listing's gallery is never touched.
      const listing = await getScopedListingForUpdate(tx, actor, listingId);
      if (listing === undefined || !isSellerEditable(listing.status)) {
        throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
      }
      const lockedUpload = await getScopedUploadForUpdate(
        tx,
        actor,
        uploadId,
        listingId,
      );
      if (lockedUpload === undefined) {
        throw new ApiError("IMAGE_UPLOAD_NOT_FOUND", "Upload not found.");
      }
      // Idempotency: a concurrent confirm already completed this upload.
      if (lockedUpload.image_id !== null) {
        const existing = await getListingImage(tx, lockedUpload.image_id, listingId);
        if (existing === undefined) {
          throw new ApiError("IMAGE_UPLOAD_NOT_FOUND", "Upload not found.");
        }
        return { row: existing, revision: listing.revision, inserted: false };
      }
      const [imageMax, imageCount] = [
        await getListingImageMax(tx),
        await countListingImages(tx, listingId),
      ];
      if (imageCount >= imageMax) {
        throw new ApiError(
          "LISTING_IMAGE_LIMIT_REACHED",
          `A listing can have at most ${imageMax} images.`,
        );
      }
      const row = await insertListingImage(tx, {
        id: uploadId,
        listingId,
        storagePath: finalPath,
        sortOrder: imageCount,
        isPrimary: imageCount === 0,
        width: processed.width,
        height: processed.height,
        mimeType: processed.mimeType,
        fileSizeBytes: processed.sizeBytes,
      });
      await completeImageUpload(tx, uploadId, row.id);
      const newRevision = await incrementListingRevision(tx, listingId);
      return { row, revision: newRevision, inserted: true };
    });
    imageRow = result.row;
    revision = result.revision;
  } catch (error) {
    // Compensation: the DB step failed, so the final object must not
    // linger as an unreferenced success.
    await storage
      .deleteObject(config.imagesBucket, finalPath)
      .catch(() => undefined);
    throw error;
  }

  await deleteTempQuietly(upload.temp_storage_path);
  const image = await toListingImageDto(imageRow);
  return { image, revision };
}

export async function confirmUpload(
  auth: AuthContext,
  listingId: string,
  uploadId: string,
): Promise<ConfirmResult> {
  return confirmUploadFor(userActor(auth), listingId, uploadId);
}

export async function confirmGuestUpload(
  session: { sessionId: string } | null,
  listingId: string,
  uploadId: string,
): Promise<ConfirmResult> {
  return confirmUploadFor(guestActor(session), listingId, uploadId);
}

async function deleteTempQuietly(tempPath: string): Promise<void> {
  const config = listingImageConfig();
  await getStorageProvider()
    .deleteObject(config.uploadsBucket, tempPath)
    .catch(() => undefined);
}

// --- delete / reorder / primary --------------------------------------------

async function deleteImageFor(
  actor: ImageActor,
  listingId: string,
  imageId: string,
): Promise<{ revision: number }> {
  await requireScopedDraft(actor, listingId);
  const result = await withTransaction(async (tx) => {
    const listing = await getScopedListingForUpdate(tx, actor, listingId);
    if (listing === undefined || !isSellerEditable(listing.status)) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    const removed = await deleteListingImage(tx, imageId, listingId);
    if (removed === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "Image not found.");
    }
    if (removed.is_primary) {
      // Deterministic: next image by sort_order becomes primary.
      await promoteNextPrimaryImage(tx, listingId);
    }
    const revision = await incrementListingRevision(tx, listingId);
    return { revision, storagePath: removed.storage_path };
  });
  // DB is the source of truth; storage removal is best-effort and a
  // future cleanup job can sweep orphans.
  const config = listingImageConfig();
  await getStorageProvider()
    .deleteObject(config.imagesBucket, result.storagePath)
    .catch(() => undefined);
  return { revision: result.revision };
}

export async function deleteImage(
  auth: AuthContext,
  listingId: string,
  imageId: string,
): Promise<{ revision: number }> {
  return deleteImageFor(userActor(auth), listingId, imageId);
}

export async function deleteGuestImage(
  session: { sessionId: string } | null,
  listingId: string,
  imageId: string,
): Promise<{ revision: number }> {
  return deleteImageFor(guestActor(session), listingId, imageId);
}

async function reorderImagesFor(
  actor: ImageActor,
  listingId: string,
  orderedImageIds: string[],
): Promise<{ revision: number }> {
  await requireScopedDraft(actor, listingId);
  return withTransaction(async (tx) => {
    const listing = await getScopedListingForUpdate(tx, actor, listingId);
    if (listing === undefined || !isSellerEditable(listing.status)) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    const images = await listListingImages(tx, listingId);
    const existingIds = images.map((image) => image.id).sort();
    const requestedIds = [...orderedImageIds].sort();
    const exactMatch =
      existingIds.length === requestedIds.length &&
      existingIds.every((id, index) => id === requestedIds[index]);
    if (!exactMatch) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "The order list must contain exactly the listing's image IDs.",
      );
    }
    for (let index = 0; index < orderedImageIds.length; index += 1) {
      await setImageSortOrder(tx, orderedImageIds[index], listingId, index);
    }
    const revision = await incrementListingRevision(tx, listingId);
    return { revision };
  });
}

export async function reorderImages(
  auth: AuthContext,
  listingId: string,
  orderedImageIds: string[],
): Promise<{ revision: number }> {
  return reorderImagesFor(userActor(auth), listingId, orderedImageIds);
}

export async function reorderGuestImages(
  session: { sessionId: string } | null,
  listingId: string,
  orderedImageIds: string[],
): Promise<{ revision: number }> {
  return reorderImagesFor(guestActor(session), listingId, orderedImageIds);
}

async function setPrimaryFor(
  actor: ImageActor,
  listingId: string,
  imageId: string,
): Promise<{ revision: number }> {
  await requireScopedDraft(actor, listingId);
  return withTransaction(async (tx) => {
    const listing = await getScopedListingForUpdate(tx, actor, listingId);
    if (listing === undefined || !isSellerEditable(listing.status)) {
      throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
    }
    const image = await getListingImage(tx, imageId, listingId);
    if (image === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "Image not found.");
    }
    if (!image.is_primary) {
      await clearPrimaryImage(tx, listingId);
      await setPrimaryImage(tx, imageId, listingId);
    }
    const revision = await incrementListingRevision(tx, listingId);
    return { revision };
  });
}

export async function setPrimary(
  auth: AuthContext,
  listingId: string,
  imageId: string,
): Promise<{ revision: number }> {
  return setPrimaryFor(userActor(auth), listingId, imageId);
}

export async function setGuestPrimary(
  session: { sessionId: string } | null,
  listingId: string,
  imageId: string,
): Promise<{ revision: number }> {
  return setPrimaryFor(guestActor(session), listingId, imageId);
}
