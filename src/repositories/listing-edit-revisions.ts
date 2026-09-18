import type { Sql } from "@/lib/server/db/client";

/**
 * O.12 edit-revision persistence. A revision row is a FULL editable
 * snapshot (`data` = the seller draft-PATCH field space incl.
 * feature_ids) with its OWN optimistic counter — independent from
 * listings.revision, so listing-level visibility writes never create
 * false edit conflicts. At most one OPEN revision per listing is
 * enforced by a partial unique index; terminal revisions
 * (APPROVED/REJECTED/CANCELLED) never block a later new edit.
 */

export const OPEN_EDIT_STATUSES = [
  "EDIT_DRAFT",
  "PENDING_MODERATION",
  "CORRECTION_REQUIRED",
] as const;

export interface EditRevisionRow {
  id: string;
  listing_id: string;
  status: string;
  data: Record<string, unknown>;
  revision: number;
  submitted_at: Date | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function getOpenEditRevision(
  sql: Sql,
  listingId: string,
): Promise<EditRevisionRow | undefined> {
  const rows = await sql<EditRevisionRow[]>`
    select * from listing_edit_revisions
    where listing_id = ${listingId}
      and status in ('EDIT_DRAFT', 'PENDING_MODERATION', 'CORRECTION_REQUIRED')
    limit 1
  `;
  return rows[0];
}

/** Lock the open revision row inside a transaction (listing row must
    already be locked first — single lock order everywhere). */
export async function lockOpenEditRevision(
  sql: Sql,
  listingId: string,
): Promise<EditRevisionRow | undefined> {
  const rows = await sql<EditRevisionRow[]>`
    select * from listing_edit_revisions
    where listing_id = ${listingId}
      and status in ('EDIT_DRAFT', 'PENDING_MODERATION', 'CORRECTION_REQUIRED')
    for update
  `;
  return rows[0];
}

/**
 * Insert a new EDIT_DRAFT revision. Returns null when the partial
 * unique index refuses (a concurrent request created the open revision
 * first) — callers then re-select the winner. Never throws for that
 * expected race.
 */
export async function insertEditRevision(
  sql: Sql,
  input: { listingId: string; data: Record<string, unknown> },
): Promise<EditRevisionRow | null> {
  const rows = await sql<EditRevisionRow[]>`
    insert into listing_edit_revisions (listing_id, data)
    values (${input.listingId}, ${sql.json(JSON.parse(JSON.stringify(input.data)))})
    on conflict do nothing
    returning *
  `;
  return rows[0] ?? null;
}

/** Merge fields into the snapshot, guarded by the edit's own counter. */
export async function updateEditRevisionData(
  sql: Sql,
  input: { revisionId: string; expectedRevision: number; data: Record<string, unknown> },
): Promise<EditRevisionRow | undefined> {
  const rows = await sql<EditRevisionRow[]>`
    update listing_edit_revisions
    set data = data || ${sql.json(JSON.parse(JSON.stringify(input.data)))},
        revision = revision + 1
    where id = ${input.revisionId}
      and revision = ${input.expectedRevision}
      and status in ('EDIT_DRAFT', 'CORRECTION_REQUIRED')
    returning *
  `;
  return rows[0];
}

/**
 * Unconditional counter bump for serialized staged-image operations
 * (the editor refetches after each op — mirroring the draft flow's
 * incrementListingRevision). Guarded to editable states only.
 */
export async function incrementEditRevision(
  sql: Sql,
  revisionId: string,
): Promise<number> {
  const rows = await sql<{ revision: number }[]>`
    update listing_edit_revisions
    set revision = revision + 1
    where id = ${revisionId}
      and status in ('EDIT_DRAFT', 'CORRECTION_REQUIRED')
    returning revision
  `;
  return rows[0]?.revision ?? 0;
}

/**
 * Submit/resubmit transition to PENDING_MODERATION. A pure state
 * transition: the content is unchanged, so the edit's own counter is
 * NOT bumped (retries with the same expected revision are idempotent
 * at the service layer).
 */
export async function submitEditRevisionRow(
  sql: Sql,
  input: { revisionId: string; expectedRevision: number },
): Promise<EditRevisionRow | undefined> {
  const rows = await sql<EditRevisionRow[]>`
    update listing_edit_revisions
    set status = 'PENDING_MODERATION',
        submitted_at = now()
    where id = ${input.revisionId}
      and revision = ${input.expectedRevision}
      and status in ('EDIT_DRAFT', 'CORRECTION_REQUIRED')
    returning *
  `;
  return rows[0];
}

/** Terminal transition to CANCELLED (allowed source states guarded by
    the service). */
export async function cancelEditRevision(
  sql: Sql,
  input: { revisionId: string; expectedRevision: number },
): Promise<EditRevisionRow | undefined> {
  const rows = await sql<EditRevisionRow[]>`
    update listing_edit_revisions
    set status = 'CANCELLED',
        decided_at = now(),
        revision = revision + 1
    where id = ${input.revisionId}
      and revision = ${input.expectedRevision}
      and status in ('EDIT_DRAFT', 'CORRECTION_REQUIRED')
    returning *
  `;
  return rows[0];
}

export interface EditImageRow {
  id: string;
  edit_revision_id: string;
  storage_path: string;
  sort_order: number;
  is_primary: boolean;
  width: number | null;
  height: number | null;
  mime_type: string;
  file_size_bytes: string;
  created_at: Date;
}

export async function listEditRevisionImages(
  sql: Sql,
  revisionId: string,
): Promise<EditImageRow[]> {
  return sql<EditImageRow[]>`
    select * from listing_edit_images
    where edit_revision_id = ${revisionId}
    order by sort_order, created_at
  `;
}

/**
 * Seed the staged gallery from the CURRENT approved gallery: row
 * copies referencing the SAME storage paths (objects are never
 * duplicated), preserving order/primary/metadata. listing_images is
 * never touched — the public gallery stays approved-backed.
 */
export async function snapshotApprovedImages(
  sql: Sql,
  input: { listingId: string; revisionId: string },
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    insert into listing_edit_images
      (edit_revision_id, storage_path, sort_order, is_primary, width, height, mime_type, file_size_bytes)
    select ${input.revisionId}, storage_path, sort_order, is_primary, width, height, mime_type, file_size_bytes
    from listing_images
    where listing_id = ${input.listingId}
    returning id
  `;
  return rows.length;
}
