"use client";

import { useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
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
/** Advisory client cap matching the product rule; the server's
    listing.image_max setting stays the enforcement authority. */
const MAX_IMAGES = 20;
const MIN_IMAGES = 3;

interface UploadItem {
  key: number;
  name: string;
  state: "uploading" | "processing" | "error";
  message: string | null;
  /** Kept for retry; null once confirmed or for client-side rejects. */
  file: File | null;
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
 * O.9 AXIN Şəkillər (components.md): 4:3 r8 tile grid — dashed add
 * tile (click or desktop drag/drop), per-tile uploading/processing/
 * error+retry states, primary tile with the ƏSAS ŞƏKİL chip, desktop
 * drag reorder with the accessible move-button alternative, delete ✕.
 * The proven pipeline is untouched: browser → signed URL → confirm,
 * two-worker queue, every confirm/delete/reorder/primary serialized
 * through the editor so revisions never race, DTO refetch adopts
 * server-side ordering and primary promotion.
 */
export function PhotosStep({ editor }: { editor: ListingEditor }) {
  const { dto } = editor;
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const keyRef = useRef(0);

  const activeUploads = uploads.filter((u) => u.state !== "error").length;
  const total = dto.images.length + activeUploads;
  const capacityLeft = Math.max(0, MAX_IMAGES - total);
  const missing = Math.max(0, MIN_IMAGES - dto.images.length);

  function patchUpload(key: number, patch: Partial<UploadItem>) {
    setUploads((current) => current.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }
  function dropUpload(key: number) {
    setUploads((current) => current.filter((u) => u.key !== key));
  }

  async function runUpload(key: number, file: File): Promise<void> {
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

  async function processFile(file: File): Promise<void> {
    keyRef.current += 1;
    const key = keyRef.current;
    setUploads((current) => [...current, { key, name: file.name, state: "uploading", message: null, file }]);
    if (!ACCEPTED.includes(file.type)) {
      patchUpload(key, { state: "error", message: SELLER.photoUnsupported, file: null });
      return;
    }
    if (file.size > MAX_BYTES) {
      patchUpload(key, { state: "error", message: SELLER.photoTooLarge, file: null });
      return;
    }
    await runUpload(key, file);
  }

  function retryUpload(item: UploadItem) {
    if (item.file === null) return;
    patchUpload(item.key, { state: "uploading", message: null });
    void runUpload(item.key, item.file);
  }

  async function onFilesSelected(files: FileList | File[] | null) {
    if (files === null) return;
    // Client-side capacity guard: never start an impossible 21st
    // upload (the server still enforces the real limit).
    const queue = [...files].slice(0, capacityLeft);
    const overflow = [...files].length - queue.length;
    if (inputRef.current !== null) inputRef.current.value = "";
    if (overflow > 0) {
      keyRef.current += 1;
      setUploads((current) => [
        ...current,
        { key: keyRef.current, name: `${overflow} fayl`, state: "error", message: SELLER.photoLimitReached, file: null },
      ]);
    }
    if (queue.length === 0) return;
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

  /** Desktop drag reorder — persisted through the same endpoint. */
  function dropOn(targetId: string) {
    const sourceId = dragId;
    setDragId(null);
    setDropTarget(null);
    if (sourceId === null || sourceId === targetId || busyImageId !== null) return;
    const ids = dto.images.map((image) => image.id).filter((id) => id !== sourceId);
    const at = ids.indexOf(targetId);
    if (at === -1) return;
    ids.splice(at, 0, sourceId);
    void imageOp(sourceId, () => reorderImages(dto.id, ids));
  }

  const tileBase = "relative aspect-[4/3] overflow-hidden rounded-lg";
  const overlayButton =
    "inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/[.92] text-ink shadow-sm transition-opacity duration-150 hover:bg-white disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1";

  return (
    <div
      className="space-y-3"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length > 0) {
          e.preventDefault();
          void onFilesSelected([...e.dataTransfer.files]);
        }
      }}
    >
      {/* Count feedback: amber minimum guidance until met, then n/max. */}
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <p
          className={`text-xs font-medium ${missing > 0 ? "text-[#9A5B06]" : "text-muted"}`}
          data-testid="wizard-photo-count"
        >
          {missing > 0
            ? `${dto.images.length}/${MIN_IMAGES} ${SELLER.photoMinimumSuffix} — daha ${missing} ${SELLER.photoNeededSuffix}`
            : `${dto.images.length} / ${MAX_IMAGES}`}
        </p>
        <p className="text-[11px] text-muted">{SELLER.photoFormats}</p>
      </div>

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

      <div className="grid grid-cols-3 gap-[7px] desk:grid-cols-4 xl:grid-cols-5" data-testid="wizard-image-grid">
        {dto.images.map((image, index) => (
          <div
            key={image.id}
            className={`${tileBase} border bg-sunken ${
              image.isPrimary ? "border-2 border-[#147A4E]" : "border-line"
            } ${dropTarget === image.id && dragId !== null && dragId !== image.id ? "ring-2 ring-primary/60" : ""}`}
            data-testid="wizard-image"
            data-image-id={image.id}
            data-primary={image.isPrimary ? "true" : "false"}
            draggable={busyImageId === null}
            onDragStart={(e) => {
              setDragId(image.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", image.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropTarget(null);
            }}
            onDragOver={(e) => {
              if (dragId !== null) {
                e.preventDefault();
                if (dropTarget !== image.id) setDropTarget(image.id);
              }
            }}
            onDrop={(e) => {
              if (dragId !== null) {
                e.preventDefault();
                e.stopPropagation();
                dropOn(image.id);
              }
            }}
          >
            {image.url !== null ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, next/image adds nothing here
              <img
                src={image.url}
                alt={`${SELLER.photos} ${index + 1}`}
                className="h-full w-full cursor-grab object-cover"
                draggable={false}
              />
            ) : null}
            {image.isPrimary ? (
              <span className="absolute left-1.5 top-1.5 rounded-[5px] bg-[#147A4E] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.04em] text-white">
                {SELLER.primaryPhoto}
              </span>
            ) : null}
            <button
              type="button"
              aria-label={`${SELLER.deletePhoto} — ${index + 1}`}
              className={`${overlayButton} absolute right-1.5 top-1.5 text-danger`}
              disabled={busyImageId !== null}
              onClick={() => void imageOp(image.id, () => deleteImage(dto.id, image.id))}
              data-testid="image-delete"
            >
              <X size={14} aria-hidden="true" />
            </button>
            <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1">
              <button
                type="button"
                aria-label={`${SELLER.moveLeft} — ${index + 1}`}
                className={overlayButton}
                disabled={index === 0 || busyImageId !== null}
                onClick={() => move(image.id, -1)}
                data-testid="image-move-left"
              >
                ←
              </button>
              <button
                type="button"
                aria-label={`${SELLER.moveRight} — ${index + 1}`}
                className={overlayButton}
                disabled={index === dto.images.length - 1 || busyImageId !== null}
                onClick={() => move(image.id, 1)}
                data-testid="image-move-right"
              >
                →
              </button>
              {!image.isPrimary ? (
                <button
                  type="button"
                  className="ml-auto inline-flex h-8 items-center rounded-full bg-white/[.92] px-2 text-[10px] font-bold uppercase tracking-[0.03em] text-[#147A4E] shadow-sm transition-colors duration-150 hover:bg-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1"
                  disabled={busyImageId !== null}
                  onClick={() => void imageOp(image.id, () => setPrimaryImage(dto.id, image.id))}
                  data-testid="image-make-primary"
                >
                  {SELLER.makePrimary}
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {/* Per-tile upload states inside the same grid. */}
        <div className="contents" data-testid="wizard-upload-queue" aria-live="polite">
          {uploads.map((upload) => (
            <div
              key={upload.key}
              className={`${tileBase} flex flex-col items-center justify-center gap-1.5 border p-2 text-center ${
                upload.state === "error" ? "border-danger/50 bg-danger-soft" : "border-line bg-sunken shimmer"
              }`}
              data-state={upload.state}
            >
              {upload.state !== "error" ? (
                <>
                  <Loader2 size={16} className="animate-spin text-muted" aria-hidden="true" />
                  <span className="max-w-full truncate text-[10.5px] text-slate-strong">{upload.name}</span>
                  <span className="text-[10.5px] font-medium text-muted">
                    {upload.state === "uploading" ? SELLER.photoUploading : SELLER.photoProcessing}
                  </span>
                </>
              ) : (
                <>
                  <span className="max-w-full truncate text-[10.5px] text-danger">{upload.name}</span>
                  <span className="text-[10.5px] font-medium leading-tight text-danger">{upload.message}</span>
                  <span className="flex items-center gap-1.5">
                    {upload.file !== null ? (
                      <button
                        type="button"
                        className="rounded-pill px-1.5 py-0.5 text-[10.5px] font-semibold text-danger underline-offset-2 hover:underline"
                        onClick={() => retryUpload(upload)}
                        data-testid="image-retry"
                      >
                        {SELLER.photoRetry}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Bağla"
                      className="rounded-pill px-1.5 py-0.5 text-[10.5px] font-semibold text-danger/80 hover:text-danger"
                      onClick={() => dropUpload(upload.key)}
                    >
                      ✕
                    </button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>

        {capacityLeft > 0 ? (
          <label
            htmlFor="wizard-photos-input"
            data-testid="wizard-photo-add"
            className={`${tileBase} flex cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed border-line-strong bg-raised text-center transition-colors duration-150 hover:border-primary hover:bg-primary-tint has-[:focus-visible]:border-primary`}
          >
            <span className="text-[13px] font-semibold text-primary">{SELLER.photoAddTile}</span>
            <span className="hidden px-2 text-[10.5px] text-muted sm:block">{SELLER.photoDropHint}</span>
          </label>
        ) : (
          <p className="col-span-full text-xs text-muted" data-testid="wizard-photo-limit">
            {SELLER.photoLimitReached}
          </p>
        )}
      </div>
    </div>
  );
}
