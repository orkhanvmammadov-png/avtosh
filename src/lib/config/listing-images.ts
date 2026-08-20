import { z } from "zod";

/**
 * Listing-image configuration with validated defaults. Values are
 * read from the environment on each call (cheap, test-friendly).
 * The per-listing image maximum deliberately lives in the
 * listing.image_max system setting (read where enforced); everything
 * here is deployment tuning.
 */
const schema = z.object({
  STORAGE_LISTING_UPLOADS_BUCKET: z.string().min(1).default("listing-uploads"),
  STORAGE_LISTING_IMAGES_BUCKET: z.string().min(1).default("listing-images"),
  LISTING_IMAGE_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(12 * 1024 * 1024),
  LISTING_IMAGE_SIGNED_UPLOAD_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  LISTING_IMAGE_SIGNED_READ_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(600),
  LISTING_IMAGE_MAX_EDGE_PX: z.coerce.number().int().positive().default(1600),
  LISTING_IMAGE_WEBP_QUALITY: z.coerce.number().int().min(1).max(100).default(80),
  LISTING_IMAGE_MAX_PENDING_UPLOADS: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
});

export interface ListingImageConfig {
  uploadsBucket: string;
  imagesBucket: string;
  maxUploadBytes: number;
  signedUploadTtlSeconds: number;
  signedReadTtlSeconds: number;
  maxEdgePx: number;
  webpQuality: number;
  maxPendingUploads: number;
}

export function listingImageConfig(): ListingImageConfig {
  const parsed = schema.parse({
    STORAGE_LISTING_UPLOADS_BUCKET: process.env.STORAGE_LISTING_UPLOADS_BUCKET,
    STORAGE_LISTING_IMAGES_BUCKET: process.env.STORAGE_LISTING_IMAGES_BUCKET,
    LISTING_IMAGE_MAX_UPLOAD_BYTES: process.env.LISTING_IMAGE_MAX_UPLOAD_BYTES,
    LISTING_IMAGE_SIGNED_UPLOAD_TTL_SECONDS:
      process.env.LISTING_IMAGE_SIGNED_UPLOAD_TTL_SECONDS,
    LISTING_IMAGE_SIGNED_READ_TTL_SECONDS:
      process.env.LISTING_IMAGE_SIGNED_READ_TTL_SECONDS,
    LISTING_IMAGE_MAX_EDGE_PX: process.env.LISTING_IMAGE_MAX_EDGE_PX,
    LISTING_IMAGE_WEBP_QUALITY: process.env.LISTING_IMAGE_WEBP_QUALITY,
    LISTING_IMAGE_MAX_PENDING_UPLOADS:
      process.env.LISTING_IMAGE_MAX_PENDING_UPLOADS,
  });
  return {
    uploadsBucket: parsed.STORAGE_LISTING_UPLOADS_BUCKET,
    imagesBucket: parsed.STORAGE_LISTING_IMAGES_BUCKET,
    maxUploadBytes: parsed.LISTING_IMAGE_MAX_UPLOAD_BYTES,
    signedUploadTtlSeconds: parsed.LISTING_IMAGE_SIGNED_UPLOAD_TTL_SECONDS,
    signedReadTtlSeconds: parsed.LISTING_IMAGE_SIGNED_READ_TTL_SECONDS,
    maxEdgePx: parsed.LISTING_IMAGE_MAX_EDGE_PX,
    webpQuality: parsed.LISTING_IMAGE_WEBP_QUALITY,
    maxPendingUploads: parsed.LISTING_IMAGE_MAX_PENDING_UPLOADS,
  };
}

/** Accepted image MIME types (untrusted hints; real decode decides). */
export const ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
