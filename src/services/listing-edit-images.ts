import { randomUUID } from "node:crypto";
import type { AuthContext } from "@/auth/current-user";
import { ApiError } from "@/lib/api/errors";
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
  clearPrimaryEditImage,
  countEditImages,
  deleteEditImage,
  getEditImage,
  insertEditImage,
  promoteNextPrimaryEditImage,
  setEditImageSortOrder,
  setPrimaryEditImage,
} from "@/repositories/listing-edit-images";
import {
  incrementEditRevision,
  listEditRevisionImages,
  lockOpenEditRevision,
  type EditRevisionRow,
} from "@/repositories/listing-edit-revisions";
import { lockOwnedListingForLifecycle } from "@/repositories/listing-lifecycle";
import {
  countPendingUploads,
  getImageUpload,
  getImageUploadForUpdate,
  getListingImageMax,
  insertImageUpload,
  markImageUploadStatus,
  completeEditImageUpload,
} from "@/repositories/listing-images";
import { insertOutboxEvent } from "@/repositories/listing-publications";
import { toListingImageDto, type ListingImageDto } from "@/services/listing-dto";

/**
 * O.12 staged-image operations — the draft image pipeline retargeted
 * at listing_edit_images. Storage-safety contract (§18):
 * - listing_images (the approved public gallery) is NEVER written
 * - removing a staged image removes ONLY the row reference; the
 *   storage object may be shared with the approved gallery, so
 *   deletion is never synchronous — a cleanup CANDIDATE outbox event
 *   lets a future reference-checking worker decide
 * - new uploads land in staging only.
 * Uploads reuse the existing listing_image_uploads staging table
 * (listing-scoped); the pre-publication draft endpoints can never
 * confirm them into listing_images because ACTIVE/EXPIRED statuses are
 * not seller-editable there.
 */

interface EditableRevisionContext {
  revision: EditRevisionRow;
}

/** Listing lock first, revision lock second (sealed order); editable
    revision states only. */
async function lockEditableRevision(
  tx: Sql,
  listingId: string,
  ownerId: string,
): Promise<EditableRevisionContext> {
  const listing = await lockOwnedListingForLifecycle(tx, listingId, ownerId);
  if (listing === undefined || listing.deleted_at !== null || listing.status === "DELETED") {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  const revision = await lockOpenEditRevision(tx, listingId);
  if (revision === undefined) {
    throw new ApiError("LISTING_LIFECYCLE_CONFLICT", "No open edit revision.");
  }
  if (revision.status === "PENDING_MODERATION") {
    throw new ApiError(
      "LISTING_LIFECYCLE_CONFLICT",
      "An edit under moderation cannot be changed.",
      { details: { edit_status: revision.status } },
    );
  }
  return { revision };
}

export interface EditUploadAuthorization {
  uploadId: string;
  uploadUrl: string;
  uploadToken: string | null;
  expiresInSeconds: number;
  maxSizeBytes: number;
}

export async function createEditUploadAuthorization(
  auth: AuthContext,
  listingId: string,
  declared: { mimeType: string; sizeBytes: number },
): Promise<EditUploadAuthorization> {
  const config = listingImageConfig();
  if (!(ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(declared.mimeType)) {
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
    const { revision } = await lockEditableRevision(tx, listingId, auth.user.id);
    const [imageMax, imageCount, pendingCount] = [
      await getListingImageMax(tx),
      await countEditImages(tx, revision.id),
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

export interface EditConfirmResult {
  image: ListingImageDto;
  revision: number;
}

export async function confirmEditUpload(
  auth: AuthContext,
  listingId: string,
  uploadId: string,
): Promise<EditConfirmResult> {
  const config = listingImageConfig();
  const sql = getSql();
  const storage = getStorageProvider();

  const upload = await getImageUpload(sql, uploadId, listingId, auth.user.id);
  if (upload === undefined) {
    throw new ApiError("IMAGE_UPLOAD_NOT_FOUND", "Upload not found.");
  }
  if (upload.status === "COMPLETED" && upload.edit_image_id !== null) {
    // idempotent confirm retry — the staged image already exists
    const open = await withTransaction(async (tx) =>
      lockOpenEditRevision(tx, listingId),
    );
    const existing =
      open === undefined ? undefined : await getEditImage(sql, upload.edit_image_id, open.id);
    if (existing !== undefined) {
      return {
        image: await toListingImageDto(existing),
        revision: open!.revision,
      };
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

  const original = await storage.downloadObject(config.uploadsBucket, upload.temp_storage_path);
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
        error.reason === "INVALID_FORMAT" ? "IMAGE_INVALID_FORMAT" : "IMAGE_PROCESSING_FAILED",
        error.message,
      );
    }
    throw new ApiError("IMAGE_PROCESSING_FAILED", "The image could not be processed.");
  }

  // Same opaque final-path scheme as the approved pipeline (image id =
  // upload id) — revision-only objects are indistinguishable from
  // approved ones and reveal nothing internal.
  const finalPath = `listings/${uploadId}.webp`;
  await storage.uploadObject(config.imagesBucket, finalPath, processed.data, processed.mimeType);

  let staged;
  try {
    staged = await withTransaction(async (tx) => {
      const { revision } = await lockEditableRevision(tx, listingId, auth.user.id);
      const lockedUpload = await getImageUploadForUpdate(tx, uploadId, listingId, auth.user.id);
      if (lockedUpload === undefined) {
        throw new ApiError("IMAGE_UPLOAD_NOT_FOUND", "Upload not found.");
      }
      if (lockedUpload.edit_image_id !== null) {
        const existing = await getEditImage(tx, lockedUpload.edit_image_id, revision.id);
        if (existing === undefined) {
          throw new ApiError("IMAGE_UPLOAD_NOT_FOUND", "Upload not found.");
        }
        return { row: existing, revision: revision.revision };
      }
      const [imageMax, imageCount] = [
        await getListingImageMax(tx),
        await countEditImages(tx, revision.id),
      ];
      if (imageCount >= imageMax) {
        throw new ApiError(
          "LISTING_IMAGE_LIMIT_REACHED",
          `A listing can have at most ${imageMax} images.`,
        );
      }
      const row = await insertEditImage(tx, {
        id: uploadId,
        revisionId: revision.id,
        storagePath: finalPath,
        sortOrder: imageCount,
        isPrimary: imageCount === 0,
        width: processed.width,
        height: processed.height,
        mimeType: processed.mimeType,
        fileSizeBytes: processed.sizeBytes,
      });
      await completeEditImageUpload(tx, uploadId, row.id);
      const newRevision = await incrementEditRevision(tx, revision.id);
      return { row, revision: newRevision };
    });
  } catch (error) {
    await storage.deleteObject(config.imagesBucket, finalPath).catch(() => undefined);
    throw error;
  }

  await deleteTempQuietly(upload.temp_storage_path);
  return {
    image: await toListingImageDto(staged.row),
    revision: staged.revision,
  };
}

async function deleteTempQuietly(tempPath: string): Promise<void> {
  const config = listingImageConfig();
  await getStorageProvider()
    .deleteObject(config.uploadsBucket, tempPath)
    .catch(() => undefined);
}

/**
 * Remove a staged image: the ROW only. The storage object is never
 * deleted synchronously (it may back the approved public gallery); a
 * cleanup-candidate event lets a reference-checking worker decide.
 */
export async function deleteStagedImage(
  auth: AuthContext,
  listingId: string,
  imageId: string,
): Promise<{ revision: number }> {
  return withTransaction(async (tx) => {
    const { revision } = await lockEditableRevision(tx, listingId, auth.user.id);
    const removed = await deleteEditImage(tx, imageId, revision.id);
    if (removed === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "Image not found.");
    }
    if (removed.is_primary) {
      await promoteNextPrimaryEditImage(tx, revision.id);
    }
    const next = await incrementEditRevision(tx, revision.id);
    await insertOutboxEvent(tx, {
      eventType: "LISTING_EDIT_IMAGE_REMOVED",
      aggregateId: listingId,
      payload: {
        listing_id: listingId,
        edit_revision_id: revision.id,
        // candidate ONLY — deletable later only when neither
        // listing_images nor listing_edit_images references it
        cleanup_candidate_paths: removed.storage_path,
      },
    });
    return { revision: next };
  });
}

export async function reorderStagedImages(
  auth: AuthContext,
  listingId: string,
  orderedImageIds: string[],
): Promise<{ revision: number }> {
  return withTransaction(async (tx) => {
    const { revision } = await lockEditableRevision(tx, listingId, auth.user.id);
    const images = await listEditRevisionImages(tx, revision.id);
    const existingIds = images.map((image) => image.id).sort();
    const requestedIds = [...orderedImageIds].sort();
    const exactMatch =
      existingIds.length === requestedIds.length &&
      existingIds.every((id, index) => id === requestedIds[index]);
    if (!exactMatch) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "The order list must contain exactly the staged image IDs.",
      );
    }
    for (let index = 0; index < orderedImageIds.length; index += 1) {
      await setEditImageSortOrder(tx, orderedImageIds[index], revision.id, index);
    }
    const next = await incrementEditRevision(tx, revision.id);
    return { revision: next };
  });
}

export async function setStagedPrimary(
  auth: AuthContext,
  listingId: string,
  imageId: string,
): Promise<{ revision: number }> {
  return withTransaction(async (tx) => {
    const { revision } = await lockEditableRevision(tx, listingId, auth.user.id);
    const image = await getEditImage(tx, imageId, revision.id);
    if (image === undefined) {
      throw new ApiError("LISTING_NOT_FOUND", "Image not found.");
    }
    if (!image.is_primary) {
      await clearPrimaryEditImage(tx, revision.id);
      await setPrimaryEditImage(tx, imageId, revision.id);
    }
    const next = await incrementEditRevision(tx, revision.id);
    return { revision: next };
  });
}
