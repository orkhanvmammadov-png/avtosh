import { listingImageConfig } from "@/lib/config/listing-images";
import { getStorageProvider } from "@/providers/storage/factory";
import type { ListingImageRow } from "@/repositories/listing-images";
import type { ListingRow } from "@/repositories/listings";

/**
 * Owner-facing DTOs. Draft images are private seller content, so
 * image URLs are short-lived signed read URLs — storage paths and
 * bucket internals are never exposed.
 */

export interface ListingImageDto {
  id: string;
  sortOrder: number;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
  mimeType: string;
  url: string;
}

export interface OwnerListingDto {
  id: string;
  publicId: string;
  status: string;
  revision: number;
  category: string;
  brandId: string | null;
  modelId: string | null;
  year: number | null;
  priceMinor: number | null;
  currency: string;
  mileage: number | null;
  engineCc: number | null;
  fuelTypeId: string | null;
  transmissionId: string | null;
  bodyTypeId: string | null;
  driveTypeId: string | null;
  motorcycleTypeId: string | null;
  colorId: string | null;
  cityId: string | null;
  creditAvailable: boolean;
  barterAvailable: boolean;
  description: string | null;
  contactPhone: string | null;
  featureIds: string[];
  images: ListingImageDto[];
  createdAt: string;
  updatedAt: string;
}

export async function toListingImageDto(
  row: ListingImageRow,
): Promise<ListingImageDto> {
  const config = listingImageConfig();
  const url = await getStorageProvider().createSignedReadUrl(
    config.imagesBucket,
    row.storage_path,
    config.signedReadTtlSeconds,
  );
  return {
    id: row.id,
    sortOrder: row.sort_order,
    isPrimary: row.is_primary,
    width: row.width,
    height: row.height,
    mimeType: row.mime_type,
    url,
  };
}

export async function toOwnerListingDto(
  row: ListingRow,
  featureIds: string[],
  imageRows: ListingImageRow[],
): Promise<OwnerListingDto> {
  const images: ListingImageDto[] = [];
  for (const imageRow of imageRows) {
    images.push(await toListingImageDto(imageRow));
  }
  return {
    id: row.id,
    publicId: row.public_id,
    status: row.status,
    revision: row.revision,
    category: row.category_code,
    brandId: row.brand_id,
    modelId: row.model_id,
    year: row.year,
    priceMinor: row.price_minor === null ? null : Number(row.price_minor),
    currency: row.currency,
    mileage: row.mileage,
    engineCc: row.engine_cc,
    fuelTypeId: row.fuel_type_id,
    transmissionId: row.transmission_id,
    bodyTypeId: row.body_type_id,
    driveTypeId: row.drive_type_id,
    motorcycleTypeId: row.motorcycle_type_id,
    colorId: row.color_id,
    cityId: row.city_id,
    creditAvailable: row.credit_available,
    barterAvailable: row.barter_available,
    description: row.description,
    contactPhone: row.contact_phone_e164,
    featureIds,
    images,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
