import { randomUUID } from "node:crypto";
import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  listingImageConfig,
} from "@/lib/config/listing-images";
import { getSql, withTransaction } from "@/lib/server/db/client";
import {
  ImageProcessingError,
  processListingImage,
} from "@/lib/server/images/process";
import { getStorageProvider } from "@/providers/storage/factory";
import {
  clearPrimaryImage,
  completeImageUpload,
  countListingImages,
  countPendingUploads,
  deleteListingImage,
  getImageUpload,
  getImageUploadForUpdate,
  getListingImage,
  getListingImageMax,
  insertImageUpload,
  insertListingImage,
  listListingImages,
  markImageUploadStatus,
  promoteNextPrimaryImage,
  setImageSortOrder,
  setPrimaryImage,
  type ListingImageRow,
} from "@/repositories/listing-images";
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
 */

async function requireOwnedDraft(
  listingId: string,
  ownerId: string,
): Promise<void> {
  const listing = await getOwnedListing(getSql(), listingId, ownerId);
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

// --- upload authorization ---------------------------------------------------

export interface UploadAuthorization {
  uploadId: string;
  uploadUrl: string;
  uploadToken: string | null;
  expiresInSeconds: number;
  maxSizeBytes: number;
}

export async function createUploadAuthorization(
  auth: AuthContext,
  listingId: string,
  declared: { mimeType: string; sizeBytes: number },
): Promise<UploadAuthorization> {
  const config = listingImageConfig();
  await requireOwnedDraft(listingId, auth.user.id);

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
  // Server-generated path — client input never reaches storage paths.
  const tempPath = `uploads/${auth.user.id}/${listingId}/${uploadId}`;

  await withTransaction(async (tx) => {
    const listing = await getOwnedListingForUpdate(tx, listingId, auth.user.id);
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
    await insertImageUpload(tx, {
      id: uploadId,
      listingId,
      userId: auth.user.id,
      tempStoragePath: tempPath,
      declaredMimeType: declared.mimeType,
      declaredSizeBytes: declared.sizeBytes,
      expiresAt: new Date(Date.now() + config.signedUploadTtlSeconds * 1000),
    });
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

// --- confirmation -----------------------------------------------------------

export interface ConfirmResult {
  image: ListingImageDto;
  revision: number;
}

export async function confirmUpload(
  auth: AuthContext,
  listingId: string,
  uploadId: string,
): Promise<ConfirmResult> {
  const config = listingImageConfig();
  const sql = getSql();
  const storage = getStorageProvider();
  await requireOwnedDraft(listingId, auth.user.id);

  // Snapshot of the upload row (unlocked — the authoritative
  // idempotency/limit decisions happen inside the final transaction).
  const upload = await getImageUpload(sql, uploadId, listingId, auth.user.id);
  if (upload === undefined) {
    throw new ApiError("IMAGE_UPLOAD_NOT_FOUND", "Upload not found.");
  }
  if (upload.status === "COMPLETED" && upload.image_id !== null) {
    const existing = await getListingImage(sql, upload.image_id, listingId);
    if (existing !== undefined) {
      const image = await toListingImageDto(existing);
      const listing = await getOwnedListing(sql, listingId, auth.user.id);
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
      const listing = await getOwnedListingForUpdate(tx, listingId, auth.user.id);
      if (listing === undefined || !isSellerEditable(listing.status)) {
        throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
      }
      const lockedUpload = await getImageUploadForUpdate(
        tx,
        uploadId,
        listingId,
        auth.user.id,
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

async function deleteTempQuietly(tempPath: string): Promise<void> {
  const config = listingImageConfig();
  await getStorageProvider()
    .deleteObject(config.uploadsBucket, tempPath)
    .catch(() => undefined);
}

// --- delete / reorder / primary --------------------------------------------

export async function deleteImage(
  auth: AuthContext,
  listingId: string,
  imageId: string,
): Promise<{ revision: number }> {
  await requireOwnedDraft(listingId, auth.user.id);
  const result = await withTransaction(async (tx) => {
    const listing = await getOwnedListingForUpdate(tx, listingId, auth.user.id);
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

export async function reorderImages(
  auth: AuthContext,
  listingId: string,
  orderedImageIds: string[],
): Promise<{ revision: number }> {
  await requireOwnedDraft(listingId, auth.user.id);
  return withTransaction(async (tx) => {
    const listing = await getOwnedListingForUpdate(tx, listingId, auth.user.id);
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

export async function setPrimary(
  auth: AuthContext,
  listingId: string,
  imageId: string,
): Promise<{ revision: number }> {
  await requireOwnedDraft(listingId, auth.user.id);
  return withTransaction(async (tx) => {
    const listing = await getOwnedListingForUpdate(tx, listingId, auth.user.id);
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
