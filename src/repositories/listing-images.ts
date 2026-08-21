import type { Sql } from "@/lib/server/db/client";

/** Listing image + pending-upload repository. Parameterized SQL only. */

export interface ListingImageRow {
  id: string;
  listing_id: string;
  storage_path: string;
  sort_order: number;
  is_primary: boolean;
  width: number | null;
  height: number | null;
  mime_type: string;
  file_size_bytes: string;
}

export interface ImageUploadRow {
  id: string;
  listing_id: string;
  user_id: string;
  temp_storage_path: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "EXPIRED";
  declared_mime_type: string;
  declared_size_bytes: string;
  image_id: string | null;
  expires_at: Date;
}

// --- images -----------------------------------------------------------------

export async function listListingImages(
  sql: Sql,
  listingId: string,
): Promise<ListingImageRow[]> {
  return sql<ListingImageRow[]>`
    select id, listing_id, storage_path, sort_order, is_primary,
           width, height, mime_type, file_size_bytes::text as file_size_bytes
    from listing_images
    where listing_id = ${listingId}
    order by sort_order, created_at
  `;
}

export async function countListingImages(
  sql: Sql,
  listingId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from listing_images
    where listing_id = ${listingId}
  `;
  return Number(rows[0].count);
}

export async function insertListingImage(
  sql: Sql,
  input: {
    id: string;
    listingId: string;
    storagePath: string;
    sortOrder: number;
    isPrimary: boolean;
    width: number;
    height: number;
    mimeType: string;
    fileSizeBytes: number;
  },
): Promise<ListingImageRow> {
  const rows = await sql<ListingImageRow[]>`
    insert into listing_images
      (id, listing_id, storage_path, sort_order, is_primary,
       width, height, mime_type, file_size_bytes)
    values
      (${input.id}, ${input.listingId}, ${input.storagePath},
       ${input.sortOrder}, ${input.isPrimary}, ${input.width},
       ${input.height}, ${input.mimeType}, ${input.fileSizeBytes})
    returning id, listing_id, storage_path, sort_order, is_primary,
              width, height, mime_type, file_size_bytes::text as file_size_bytes
  `;
  return rows[0];
}

export async function getListingImage(
  sql: Sql,
  imageId: string,
  listingId: string,
): Promise<ListingImageRow | undefined> {
  const rows = await sql<ListingImageRow[]>`
    select id, listing_id, storage_path, sort_order, is_primary,
           width, height, mime_type, file_size_bytes::text as file_size_bytes
    from listing_images
    where id = ${imageId} and listing_id = ${listingId}
  `;
  return rows[0];
}

export async function deleteListingImage(
  sql: Sql,
  imageId: string,
  listingId: string,
): Promise<ListingImageRow | undefined> {
  const rows = await sql<ListingImageRow[]>`
    delete from listing_images
    where id = ${imageId} and listing_id = ${listingId}
    returning id, listing_id, storage_path, sort_order, is_primary,
              width, height, mime_type, file_size_bytes::text as file_size_bytes
  `;
  return rows[0];
}

/** Promotes the lowest-sort_order remaining image to primary, if any. */
export async function promoteNextPrimaryImage(
  sql: Sql,
  listingId: string,
): Promise<void> {
  await sql`
    update listing_images
    set is_primary = true
    where id = (
      select id from listing_images
      where listing_id = ${listingId}
      order by sort_order, created_at
      limit 1
    )
  `;
}

export async function clearPrimaryImage(
  sql: Sql,
  listingId: string,
): Promise<void> {
  await sql`
    update listing_images
    set is_primary = false
    where listing_id = ${listingId} and is_primary
  `;
}

export async function setPrimaryImage(
  sql: Sql,
  imageId: string,
  listingId: string,
): Promise<void> {
  await sql`
    update listing_images
    set is_primary = true
    where id = ${imageId} and listing_id = ${listingId}
  `;
}

export async function setImageSortOrder(
  sql: Sql,
  imageId: string,
  listingId: string,
  sortOrder: number,
): Promise<void> {
  await sql`
    update listing_images
    set sort_order = ${sortOrder}
    where id = ${imageId} and listing_id = ${listingId}
  `;
}

// --- pending uploads --------------------------------------------------------

export async function insertImageUpload(
  sql: Sql,
  input: {
    id: string;
    listingId: string;
    userId: string;
    tempStoragePath: string;
    declaredMimeType: string;
    declaredSizeBytes: number;
    expiresAt: Date;
  },
): Promise<void> {
  await sql`
    insert into listing_image_uploads
      (id, listing_id, user_id, temp_storage_path,
       declared_mime_type, declared_size_bytes, expires_at)
    values
      (${input.id}, ${input.listingId}, ${input.userId},
       ${input.tempStoragePath}, ${input.declaredMimeType},
       ${input.declaredSizeBytes}, ${input.expiresAt})
  `;
}

export async function countPendingUploads(
  sql: Sql,
  listingId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from listing_image_uploads
    where listing_id = ${listingId}
      and status = 'PENDING'
      and expires_at > now()
  `;
  return Number(rows[0].count);
}

export async function getImageUpload(
  sql: Sql,
  uploadId: string,
  listingId: string,
  userId: string,
): Promise<ImageUploadRow | undefined> {
  const rows = await sql<ImageUploadRow[]>`
    select id, listing_id, user_id, temp_storage_path, status,
           declared_mime_type, declared_size_bytes::text as declared_size_bytes,
           image_id, expires_at
    from listing_image_uploads
    where id = ${uploadId} and listing_id = ${listingId} and user_id = ${userId}
  `;
  return rows[0];
}

/** Same lookup but row-locked inside a transaction. */
export async function getImageUploadForUpdate(
  sql: Sql,
  uploadId: string,
  listingId: string,
  userId: string,
): Promise<ImageUploadRow | undefined> {
  const rows = await sql<ImageUploadRow[]>`
    select id, listing_id, user_id, temp_storage_path, status,
           declared_mime_type, declared_size_bytes::text as declared_size_bytes,
           image_id, expires_at
    from listing_image_uploads
    where id = ${uploadId} and listing_id = ${listingId} and user_id = ${userId}
    for update
  `;
  return rows[0];
}

export async function markImageUploadStatus(
  sql: Sql,
  uploadId: string,
  status: "FAILED" | "EXPIRED",
): Promise<void> {
  await sql`
    update listing_image_uploads
    set status = ${status}::image_upload_status
    where id = ${uploadId}
  `;
}

export async function completeImageUpload(
  sql: Sql,
  uploadId: string,
  imageId: string,
): Promise<void> {
  await sql`
    update listing_image_uploads
    set status = 'COMPLETED', image_id = ${imageId}, confirmed_at = now()
    where id = ${uploadId}
  `;
}

/** The accepted listing.image_max system setting (fallback 20). */
export async function getListingImageMax(sql: Sql): Promise<number> {
  const rows = await sql<{ value: unknown }[]>`
    select value from system_settings where key = 'listing.image_max'
  `;
  const value = rows[0]?.value;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 20;
}
