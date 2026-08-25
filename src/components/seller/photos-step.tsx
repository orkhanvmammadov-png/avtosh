"use client";

import { useRef, useState } from "react";
import { PublicApiError } from "@/lib/marketplace/public-api";
import { SELLER } from "@/lib/marketplace/labels";
import {
  confirmUpload,
  deleteImage,
  reorderImages,
  requestUploadUrl,
  setPrimaryImage,
  uploadToSignedUrl,
} from "@/lib/seller/owner-api";
import type { ListingEditor } from "@/components/seller/use-listing-editor";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 12_582_912;
const PARALLEL_UPLOADS = 2;

interface UploadItem {
  key: number;
  name: string;
  state: "uploading" | "processing" | "error";
  message: string | null;
}

function uploadErrorMessage(error: unknown): string {
  if (error instanceof PublicApiError) {
    switch (error.code) {
      case "IMAGE_INVALID_FORMAT":
        return SELLER.photoUnsupported;
      case "IMAGE_TOO_LARGE":
        return SELLER.photoTooLarge;
      case "LISTING_IMAGE_LIMIT_REACHED":
        return SELLER.photoLimitReached;
    }
  }
  return SELLER.photoUploadFailed;
}

/**
 * Step 3 — images. Browser → signed URL → confirm (the accepted
 * direct-upload contract; originals never travel through the API
 * layer). Uploads run at most 2 in parallel; every confirm/delete/
 * reorder/primary is serialized through the editor so revisions never
 * race, and the DTO refetch after each op adopts server-side ordering
 * and primary promotion.
 */
export function PhotosStep({ editor }: { editor: ListingEditor }) {
  const { dto } = editor;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const keyRef = useRef(0);

  function patchUpload(key: number, patch: Partial<UploadItem>) {
    setUploads((current) => current.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }
  function dropUpload(key: number) {
    setUploads((current) => current.filter((u) => u.key !== key));
  }

  async function processFile(file: File): Promise<void> {
    keyRef.current += 1;
    const key = keyRef.current;
    setUploads((current) => [...current, { key, name: file.name, state: "uploading", message: null }]);
    if (!ACCEPTED.includes(file.type)) {
      patchUpload(key, { state: "error", message: SELLER.photoUnsupported });
      return;
    }
    if (file.size > MAX_BYTES) {
      patchUpload(key, { state: "error", message: SELLER.photoTooLarge });
      return;
    }
    try {
      const issued = await requestUploadUrl(dto.id, file);
      await uploadToSignedUrl(issued.upload_url, issued.upload_token, file);
      patchUpload(key, { state: "processing" });
      await editor.runExclusive(() => confirmUpload(dto.id, issued.upload_id));
      dropUpload(key);
    } catch (error) {
      patchUpload(key, { state: "error", message: uploadErrorMessage(error) });
    }
  }

  async function onFilesSelected(files: FileList | null) {
    if (files === null || files.length === 0) return;
    const queue = [...files];
    if (inputRef.current !== null) inputRef.current.value = "";
    const workers = Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (file !== undefined) await processFile(file);
      }
    });
    await Promise.all(workers);
  }

  async function imageOp(imageId: string, op: () => Promise<unknown>) {
    setBusyImageId(imageId);
    try {
      await editor.runExclusive(op);
    } catch {
      // conflict handling and errors surface through the editor banner
    } finally {
      setBusyImageId(null);
    }
  }

  function move(imageId: string, direction: -1 | 1) {
    const ids = dto.images.map((image) => image.id);
    const index = ids.indexOf(imageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void imageOp(imageId, () => reorderImages(dto.id, ids));
  }

  return (
    <div className="space-y-4">
      <div>
        <input
          ref={inputRef}
          id="wizard-photos-input"
          data-testid="wizard-photos-input"
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          className="sr-only"
          onChange={(e) => void onFilesSelected(e.target.files)}
        />
        <label
          htmlFor="wizard-photos-input"
          className="inline-flex min-h-12 cursor-pointer items-center rounded-lg bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          {SELLER.addPhotos}
        </label>
        <p className="mt-2 text-xs text-muted">{SELLER.photoFormats}</p>
      </div>

      {uploads.length > 0 ? (
        <ul className="space-y-2" data-testid="wizard-upload-queue" aria-live="polite">
          {uploads.map((upload) => (
            <li
              key={upload.key}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                upload.state === "error" ? "border-danger/40 bg-danger/5 text-danger" : "border-line bg-white text-navy"
              }`}
              data-state={upload.state}
            >
              <span className="min-w-0 truncate">{upload.name}</span>
              <span className="shrink-0">
                {upload.state === "uploading" ? SELLER.photoUploading : null}
                {upload.state === "processing" ? SELLER.photoProcessing : null}
                {upload.state === "error" ? upload.message : null}
              </span>
              {upload.state === "error" ? (
                <button
                  type="button"
                  className="min-h-12 shrink-0 rounded-lg px-2 text-sm font-medium text-navy"
                  onClick={() => dropUpload(upload.key)}
                >
                  Bağla
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="wizard-image-grid">
        {dto.images.map((image, index) => (
          <li
            key={image.id}
            className="overflow-hidden rounded-card border border-line bg-white"
            data-testid="wizard-image"
            data-image-id={image.id}
            data-primary={image.isPrimary ? "true" : "false"}
          >
            <div className="relative aspect-vehicle bg-line/40">
              {image.url !== null ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, next/image adds nothing here
                <img src={image.url} alt={`${SELLER.photos} ${index + 1}`} className="h-full w-full object-cover" />
              ) : null}
              {image.isPrimary ? (
                <span className="absolute left-2 top-2 rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-white">
                  {SELLER.primaryPhoto}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1 p-1.5">
              <button
                type="button"
                aria-label={`${SELLER.moveLeft} — ${index + 1}`}
                className="inline-flex h-12 w-12 items-center justify-center rounded-lg text-navy disabled:text-muted"
                disabled={index === 0 || busyImageId !== null}
                onClick={() => move(image.id, -1)}
                data-testid="image-move-left"
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`${SELLER.moveRight} — ${index + 1}`}
                className="inline-flex h-12 w-12 items-center justify-center rounded-lg text-navy disabled:text-muted"
                disabled={index === dto.images.length - 1 || busyImageId !== null}
                onClick={() => move(image.id, 1)}
                data-testid="image-move-right"
              >
                →
              </button>
              {!image.isPrimary ? (
                <button
                  type="button"
                  className="inline-flex min-h-12 items-center rounded-lg px-2 text-xs font-medium text-navy disabled:text-muted"
                  disabled={busyImageId !== null}
                  onClick={() => void imageOp(image.id, () => setPrimaryImage(dto.id, image.id))}
                  data-testid="image-make-primary"
                >
                  {SELLER.makePrimary}
                </button>
              ) : null}
              <button
                type="button"
                aria-label={`${SELLER.deletePhoto} — ${index + 1}`}
                className="ml-auto inline-flex h-12 w-12 items-center justify-center rounded-lg text-danger disabled:text-muted"
                disabled={busyImageId !== null}
                onClick={() => void imageOp(image.id, () => deleteImage(dto.id, image.id))}
                data-testid="image-delete"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
