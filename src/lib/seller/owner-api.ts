"use client";

import { publicFetch } from "@/lib/marketplace/public-api";
import type { ListingImageDto, OwnerListingDto } from "@/services/listing-dto";

/**
 * Browser client for the authenticated owner listing APIs. Types are
 * imported type-only from the server DTO module (erased at build), so
 * client and server can never drift apart silently.
 */

export type { ListingImageDto, OwnerListingDto };

export interface PatchBody {
  category?: string;
  brand_id?: string | null;
  model_id?: string | null;
  year?: number | null;
  price_minor?: number | null;
  mileage?: number | null;
  engine_cc?: number | null;
  fuel_type_id?: string | null;
  transmission_id?: string | null;
  body_type_id?: string | null;
  drive_type_id?: string | null;
  motorcycle_type_id?: string | null;
  color_id?: string | null;
  city_id?: string | null;
  credit_available?: boolean;
  no_accident?: true | null;
  not_repainted?: true | null;
  barter_available?: boolean;
  description?: string | null;
  contact_phone?: string | null;
  seller_name?: string | null;
  premium_intent_package_id?: string | null;
  boost_intent_package_id?: string | null;
  feature_ids?: string[];
}

export interface SubmitResult {
  listing: { id: string; status: string; revision: number };
  publication: { number: number; billingType: "FREE" | "PAID" };
  payment: { id: string; type: string; amountMinor: number; currency: string; status: string } | null;
  nextAction: "MODERATION" | "PAYMENT";
}

export interface QuotaDto {
  freeLimit: number;
  lifetimePublications: number;
  freeUsed: number;
  freeRemaining: number;
  nextPublicationNumber: number;
  nextPublicationIsPaid: boolean;
  listingFeeMinor: number;
  currency: string;
}

const BASE = "/api/v1/me/listings";
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export async function createListing(category: string): Promise<OwnerListingDto> {
  const r = await publicFetch<{ listing: OwnerListingDto }>(BASE, json({ category }));
  return r.data.listing;
}

export async function fetchOwnerListing(id: string): Promise<OwnerListingDto> {
  const r = await publicFetch<{ listing: OwnerListingDto }>(`${BASE}/${id}`);
  return r.data.listing;
}

export async function patchListing(
  id: string,
  expectedRevision: number,
  fields: PatchBody,
): Promise<OwnerListingDto> {
  const r = await publicFetch<{ listing: OwnerListingDto }>(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expected_revision: expectedRevision, ...fields }),
  });
  return r.data.listing;
}

export async function requestUploadUrl(
  id: string,
  file: File,
): Promise<{ upload_id: string; upload_url: string; upload_token: string | null; max_size_bytes: number }> {
  const r = await publicFetch<{
    upload_id: string;
    upload_url: string;
    upload_token: string | null;
    max_size_bytes: number;
  }>(`${BASE}/${id}/images/upload-url`, json({
    filename: file.name.slice(0, 255),
    declared_mime_type: file.type,
    declared_size_bytes: file.size,
  }));
  return r.data;
}

/** Direct browser → storage upload (never through the API layer). */
export async function uploadToSignedUrl(
  uploadUrl: string,
  token: string | null,
  file: File,
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": file.type,
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Upload failed with ${response.status}`);
  }
}

export async function confirmUpload(
  id: string,
  uploadId: string,
): Promise<{ image: ListingImageDto; revision: number }> {
  const r = await publicFetch<{ image: ListingImageDto; revision: number }>(
    `${BASE}/${id}/images/confirm`,
    json({ upload_id: uploadId }),
  );
  return r.data;
}

export async function deleteImage(id: string, imageId: string): Promise<void> {
  await publicFetch(`${BASE}/${id}/images/${imageId}`, { method: "DELETE" });
}

export async function reorderImages(id: string, imageIds: string[]): Promise<void> {
  await publicFetch(`${BASE}/${id}/images/order`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image_ids: imageIds }),
  });
}

export async function setPrimaryImage(id: string, imageId: string): Promise<void> {
  await publicFetch(`${BASE}/${id}/images/${imageId}/primary`, { method: "PATCH" });
}

export async function fetchQuota(): Promise<QuotaDto> {
  const r = await publicFetch<{ quota: QuotaDto }>("/api/v1/me/listing-quota");
  return r.data.quota;
}

/**
 * O.12 EDIT-mode persistence: the SAME editor contract (OwnerListingDto
 * shape, PatchBody field space minus promotion intent) backed by the
 * edit-revision endpoints. `revision` in the DTO is the EDIT revision's
 * own counter; the approved listing is never written from here.
 */
export const draftEditorApi = {
  fetch: fetchOwnerListing,
  patch: patchListing,
  requestUploadUrl,
  confirmUpload,
  deleteImage,
  reorderImages,
  setPrimaryImage,
};

export type EditorApi = typeof draftEditorApi;

const editBase = (id: string): string => `${BASE}/${id}/edit-revision`;

export async function fetchEditListing(id: string): Promise<OwnerListingDto> {
  const r = await publicFetch<{ listing: OwnerListingDto }>(editBase(id));
  return r.data.listing;
}

export const editEditorApi: EditorApi = {
  fetch: fetchEditListing,
  patch: async (id, expectedRevision, fields) => {
    const r = await publicFetch<{ listing: OwnerListingDto }>(editBase(id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_revision: expectedRevision, ...fields }),
    });
    return r.data.listing;
  },
  requestUploadUrl: async (id, file) => {
    const r = await publicFetch<{
      upload_id: string;
      upload_url: string;
      upload_token: string | null;
      max_size_bytes: number;
    }>(`${editBase(id)}/images/upload-url`, json({
      filename: file.name.slice(0, 255),
      declared_mime_type: file.type,
      declared_size_bytes: file.size,
    }));
    return r.data;
  },
  confirmUpload: async (id, uploadId) => {
    const r = await publicFetch<{ image: ListingImageDto; revision: number }>(
      `${editBase(id)}/images/confirm`,
      json({ upload_id: uploadId }),
    );
    return r.data;
  },
  deleteImage: async (id, imageId) => {
    await publicFetch(`${editBase(id)}/images/${imageId}`, { method: "DELETE" });
  },
  reorderImages: async (id, imageIds) => {
    await publicFetch(`${editBase(id)}/images/order`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image_ids: imageIds }),
    });
  },
  setPrimaryImage: async (id, imageId) => {
    await publicFetch(`${editBase(id)}/images/${imageId}/primary`, { method: "PATCH" });
  },
};

export interface EditSubmitResult {
  listingId: string;
  editRevisionId: string;
  editStatus: string;
  editRevision: number;
  reactivationRequested: boolean;
}

export async function createOrGetEditRevision(id: string): Promise<void> {
  await publicFetch(editBase(id), json({}));
}

export async function submitEditRevision(
  id: string,
  expectedRevision: number,
  activate: boolean,
): Promise<EditSubmitResult> {
  const r = await publicFetch<EditSubmitResult>(
    `${editBase(id)}/submit`,
    json(activate ? { expected_revision: expectedRevision, activate: true } : { expected_revision: expectedRevision }),
  );
  return r.data;
}

export async function cancelEditRevision(
  id: string,
  expectedRevision: number,
): Promise<void> {
  await publicFetch(`${editBase(id)}/cancel`, json({ expected_revision: expectedRevision }));
}

export async function submitListing(id: string, expectedRevision: number): Promise<SubmitResult> {
  const r = await publicFetch<SubmitResult>(`${BASE}/${id}/submit`, json({ expected_revision: expectedRevision }));
  return r.data;
}

export async function resubmitListing(id: string, expectedRevision: number): Promise<SubmitResult> {
  const r = await publicFetch<SubmitResult>(`${BASE}/${id}/resubmit`, json({ expected_revision: expectedRevision }));
  return r.data;
}
