import "server-only";
import sharp from "sharp";

/**
 * Listing-image processing. Every input is attacker-controlled:
 * decode for real (never trust MIME/extension), cap decode size to
 * defeat decompression bombs, allow only formats we re-encode
 * (JPEG/PNG/WebP — no SVG, no HEIC/GIF), auto-orient, strip all
 * EXIF/GPS metadata (sharp drops metadata unless explicitly kept),
 * downscale to the configured longest edge without upscaling, and
 * output normalized WebP.
 */

const DECODE_PIXEL_LIMIT = 50_000_000; // ~50MP decompression-bomb cap
const ALLOWED_DECODED_FORMATS = new Set(["jpeg", "png", "webp"]);

export type ImageRejectionReason = "INVALID_FORMAT" | "PROCESSING_FAILED";

export class ImageProcessingError extends Error {
  readonly reason: ImageRejectionReason;

  constructor(reason: ImageRejectionReason, message: string) {
    super(message);
    this.name = "ImageProcessingError";
    this.reason = reason;
  }
}

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
  mimeType: "image/webp";
  sizeBytes: number;
}

export async function processListingImage(
  input: Buffer,
  options: { maxEdgePx: number; webpQuality: number },
): Promise<ProcessedImage> {
  let format: string | undefined;
  try {
    const metadata = await sharp(input, {
      limitInputPixels: DECODE_PIXEL_LIMIT,
    }).metadata();
    format = metadata.format;
  } catch {
    throw new ImageProcessingError(
      "INVALID_FORMAT",
      "The file is not a supported image.",
    );
  }
  if (format === undefined || !ALLOWED_DECODED_FORMATS.has(format)) {
    throw new ImageProcessingError(
      "INVALID_FORMAT",
      "Only JPEG, PNG, and WebP images are supported.",
    );
  }
  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: DECODE_PIXEL_LIMIT,
    })
      .rotate() // honor EXIF orientation, then discard metadata
      .resize({
        width: options.maxEdgePx,
        height: options.maxEdgePx,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: options.webpQuality })
      .toBuffer({ resolveWithObject: true });
    return {
      data,
      width: info.width,
      height: info.height,
      mimeType: "image/webp",
      sizeBytes: data.length,
    };
  } catch {
    throw new ImageProcessingError(
      "PROCESSING_FAILED",
      "The image could not be processed.",
    );
  }
}
