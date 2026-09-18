import type { Sql } from "@/lib/server/db/client";
import type { EditImageRow } from "@/repositories/listing-edit-revisions";

/**
 * O.12 staged-image persistence (listing_edit_images). Rows reference
 * storage objects that may be SHARED with the approved gallery
 * (snapshot copies), so this layer never deletes storage objects —
 * only row references. listing_images is never touched from here.
 */

export async function countEditImages(sql: Sql, revisionId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from listing_edit_images
    where edit_revision_id = ${revisionId}
  `;
  return Number(rows[0].count);
}

export async function countPrimaryEditImages(
  sql: Sql,
  revisionId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from listing_edit_images
    where edit_revision_id = ${revisionId} and is_primary
  `;
  return Number(rows[0].count);
}

export async function getEditImage(
  sql: Sql,
  imageId: string,
  revisionId: string,
): Promise<EditImageRow | undefined> {
  const rows = await sql<EditImageRow[]>`
    select * from listing_edit_images
    where id = ${imageId} and edit_revision_id = ${revisionId}
  `;
  return rows[0];
}

export async function insertEditImage(
  sql: Sql,
  input: {
    id: string;
    revisionId: string;
    storagePath: string;
    sortOrder: number;
    isPrimary: boolean;
    width: number;
    height: number;
    mimeType: string;
    fileSizeBytes: number;
  },
): Promise<EditImageRow> {
  const rows = await sql<EditImageRow[]>`
    insert into listing_edit_images
      (id, edit_revision_id, storage_path, sort_order, is_primary, width, height, mime_type, file_size_bytes)
    values (${input.id}, ${input.revisionId}, ${input.storagePath}, ${input.sortOrder},
      ${input.isPrimary}, ${input.width}, ${input.height}, ${input.mimeType}, ${input.fileSizeBytes})
    returning *
  `;
  return rows[0];
}

/** Removes the staged ROW only — never the storage object (it may be
    shared with the approved gallery). */
export async function deleteEditImage(
  sql: Sql,
  imageId: string,
  revisionId: string,
): Promise<EditImageRow | undefined> {
  const rows = await sql<EditImageRow[]>`
    delete from listing_edit_images
    where id = ${imageId} and edit_revision_id = ${revisionId}
    returning *
  `;
  return rows[0];
}

/** Deterministic: next staged image by sort_order becomes primary. */
export async function promoteNextPrimaryEditImage(
  sql: Sql,
  revisionId: string,
): Promise<void> {
  await sql`
    update listing_edit_images
    set is_primary = true
    where id = (
      select id from listing_edit_images
      where edit_revision_id = ${revisionId}
      order by sort_order, created_at
      limit 1
    )
  `;
}

export async function setEditImageSortOrder(
  sql: Sql,
  imageId: string,
  revisionId: string,
  sortOrder: number,
): Promise<void> {
  await sql`
    update listing_edit_images
    set sort_order = ${sortOrder}
    where id = ${imageId} and edit_revision_id = ${revisionId}
  `;
}

export async function clearPrimaryEditImage(
  sql: Sql,
  revisionId: string,
): Promise<void> {
  await sql`
    update listing_edit_images set is_primary = false
    where edit_revision_id = ${revisionId} and is_primary
  `;
}

export async function setPrimaryEditImage(
  sql: Sql,
  imageId: string,
  revisionId: string,
): Promise<void> {
  await sql`
    update listing_edit_images set is_primary = true
    where id = ${imageId} and edit_revision_id = ${revisionId}
  `;
}
