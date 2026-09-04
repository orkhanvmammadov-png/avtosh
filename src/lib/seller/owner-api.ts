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

export async function submitListing(id: string, expectedRevision: number): Promise<SubmitResult> {
  const r = await publicFetch<SubmitResult>(`${BASE}/${id}/submit`, json({ expected_revision: expectedRevision }));
  return r.data;
}

export async function resubmitListing(id: string, expectedRevision: number): Promise<SubmitResult> {
  const r = await publicFetch<SubmitResult>(`${BASE}/${id}/resubmit`, json({ expected_revision: expectedRevision }));
  return r.data;
}
