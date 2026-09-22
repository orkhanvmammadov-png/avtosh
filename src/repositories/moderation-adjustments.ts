import type { Sql } from "@/lib/server/db/client";

/**
 * O.13 Stage B — moderation adjustment repository. Parameterized SQL
 * only. The frozen submitted_* columns are written ONCE at insert and
 * never appear in any UPDATE here — seller evidence is immutable by
 * construction.
 */

export interface AdjustmentRow {
  id: string;
  listing_id: string;
  edit_revision_id: string | null;
  status: "OPEN" | "DISCARDED" | "APPLIED";
  submitted_listing_revision: number;
  submitted_edit_revision_no: number | null;
  submitted_data: Record<string, unknown>;
  submitted_images: SubmittedImageSnapshot[];
  adjusted_data: Record<string, unknown>;
  image_plan: ImagePlanRowEntry[];
  moderator_id: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
  discarded_at: Date | null;
  applied_at: Date | null;
}

/** Frozen submission-image metadata (§ image snapshot contract):
    stable source identity + server-side storage identity + original
    order/primary + display metadata. NO signed URLs are persisted —
    display URLs stay a runtime read concern. */
export interface SubmittedImageSnapshot {
  source_id: string;
  storage_path: string;
  sort_order: number;
  is_primary: boolean;
  width: number | null;
  height: number | null;
  mime_type: string;
}

/** Normalized private image plan entry (full deterministic plan:
    every frozen source appears exactly once, in adjusted order). */
export interface ImagePlanRowEntry {
  source_id: string;
  removed: boolean;
  sort_order: number;
  is_primary: boolean;
}

export async function getOpenAdjustment(
  sql: Sql,
  listingId: string,
): Promise<AdjustmentRow | undefined> {
  const rows = await sql<AdjustmentRow[]>`
    select * from moderation_adjustments
    where listing_id = ${listingId} and status = 'OPEN'
  `;
  return rows[0];
}

/** Lock the open adjustment LAST (sealed order: listing → edit
    revision → adjustment). */
export async function lockOpenAdjustment(
  sql: Sql,
  listingId: string,
): Promise<AdjustmentRow | undefined> {
  const rows = await sql<AdjustmentRow[]>`
    select * from moderation_adjustments
    where listing_id = ${listingId} and status = 'OPEN'
    for update
  `;
  return rows[0];
}

export async function getAdjustmentById(
  sql: Sql,
  adjustmentId: string,
): Promise<AdjustmentRow | undefined> {
  const rows = await sql<AdjustmentRow[]>`
    select * from moderation_adjustments
    where id = ${adjustmentId}
  `;
  return rows[0];
}

/**
 * First save: freeze + create in one insert. Returns null when the
 * one-OPEN partial unique index refuses (a concurrent first save won
 * the race) — callers re-select the winner, never throw.
 */
export async function insertAdjustment(
  sql: Sql,
  input: {
    listingId: string;
    editRevisionId: string | null;
    submittedListingRevision: number;
    submittedEditRevisionNo: number | null;
    submittedData: Record<string, unknown>;
    submittedImages: SubmittedImageSnapshot[];
    adjustedData: Record<string, unknown>;
    imagePlan: ImagePlanRowEntry[];
    moderatorId: string;
  },
): Promise<AdjustmentRow | null> {
  const rows = await sql<AdjustmentRow[]>`
    insert into moderation_adjustments
      (listing_id, edit_revision_id, submitted_listing_revision,
       submitted_edit_revision_no, submitted_data, submitted_images,
       adjusted_data, image_plan, moderator_id)
    values
      (${input.listingId}, ${input.editRevisionId}, ${input.submittedListingRevision},
       ${input.submittedEditRevisionNo},
       ${sql.json(JSON.parse(JSON.stringify(input.submittedData)))},
       ${sql.json(JSON.parse(JSON.stringify(input.submittedImages)))},
       ${sql.json(JSON.parse(JSON.stringify(input.adjustedData)))},
       ${sql.json(JSON.parse(JSON.stringify(input.imagePlan)))},
       ${input.moderatorId})
    on conflict do nothing
    returning *
  `;
  return rows[0] ?? null;
}

/** Working update: adjusted content + plan only, guarded by the
    adjustment's OWN counter. submitted_* are never touched. */
export async function updateAdjustmentWorkingState(
  sql: Sql,
  input: {
    adjustmentId: string;
    expectedRevision: number;
    adjustedData: Record<string, unknown>;
    imagePlan: ImagePlanRowEntry[];
    moderatorId: string;
  },
): Promise<AdjustmentRow | undefined> {
  const rows = await sql<AdjustmentRow[]>`
    update moderation_adjustments
    set adjusted_data = ${sql.json(JSON.parse(JSON.stringify(input.adjustedData)))},
        image_plan = ${sql.json(JSON.parse(JSON.stringify(input.imagePlan)))},
        moderator_id = ${input.moderatorId},
        revision = revision + 1,
        updated_at = now()
    where id = ${input.adjustmentId}
      and revision = ${input.expectedRevision}
      and status = 'OPEN'
    returning *
  `;
  return rows[0];
}

/** O.13 Stage C — terminal APPLIED transition (adjusted approval).
    Guarded by the adjustment's own counter + OPEN status; the frozen
    submitted_* and the applied adjusted_data/image_plan are retained
    forever as audit history. */
export async function applyAdjustmentRow(
  sql: Sql,
  input: { adjustmentId: string; expectedRevision: number },
): Promise<AdjustmentRow | undefined> {
  const rows = await sql<AdjustmentRow[]>`
    update moderation_adjustments
    set status = 'APPLIED',
        applied_at = now(),
        updated_at = now()
    where id = ${input.adjustmentId}
      and revision = ${input.expectedRevision}
      and status = 'OPEN'
    returning *
  `;
  return rows[0];
}

/**
 * O.13 Stage C — materialize the saved image plan into the final
 * approved gallery. The kept sources ARE the live NEW-submission
 * listing_images rows (frozen source_id = row id), so this is a
 * delete-removed + rewrite-kept operation in plan order; metadata is
 * copied from the existing rows (never from client input). Returns
 * undefined when any kept source no longer exists (subject changed
 * underneath — caller aborts the transaction).
 */
export async function materializeImagePlanForListing(
  sql: Sql,
  input: {
    listingId: string;
    kept: { sourceId: string; isPrimary: boolean }[];
  },
): Promise<{ removedPaths: string[] } | undefined> {
  const existing = await sql<
    { id: string; storage_path: string; width: number | null; height: number | null; mime_type: string; file_size_bytes: string }[]
  >`
    select id, storage_path, width, height, mime_type, file_size_bytes
    from listing_images where listing_id = ${input.listingId}
  `;
  const byId = new Map(existing.map((row) => [row.id, row]));
  if (input.kept.some((entry) => !byId.has(entry.sourceId))) {
    return undefined;
  }
  const keptIds = new Set(input.kept.map((entry) => entry.sourceId));
  // a path that survives in the final gallery is never a candidate,
  // even when a removed duplicate row shared it
  const keptPaths = new Set(
    existing.filter((row) => keptIds.has(row.id)).map((row) => row.storage_path),
  );
  const removedPaths = existing
    .filter((row) => !keptIds.has(row.id) && !keptPaths.has(row.storage_path))
    .map((row) => row.storage_path);
  // same materialization discipline as the O.12 staged swap: rewrite
  // the gallery atomically inside the approval transaction
  await sql`delete from listing_images where listing_id = ${input.listingId}`;
  for (const [index, entry] of input.kept.entries()) {
    const source = byId.get(entry.sourceId)!;
    await sql`
      insert into listing_images
        (listing_id, storage_path, sort_order, is_primary, width, height, mime_type, file_size_bytes)
      values
        (${input.listingId}, ${source.storage_path}, ${index}, ${entry.isPrimary},
         ${source.width}, ${source.height}, ${source.mime_type}, ${source.file_size_bytes})
    `;
  }
  return { removedPaths };
}

/** Terminal discard: retained forever, never revived by mutation. */
export async function discardAdjustmentRow(
  sql: Sql,
  input: { adjustmentId: string; expectedRevision: number },
): Promise<AdjustmentRow | undefined> {
  const rows = await sql<AdjustmentRow[]>`
    update moderation_adjustments
    set status = 'DISCARDED',
        discarded_at = now(),
        updated_at = now()
    where id = ${input.adjustmentId}
      and revision = ${input.expectedRevision}
      and status = 'OPEN'
    returning *
  `;
  return rows[0];
}

/** Idempotent-discard detection: the already-terminal row. */
export async function findDiscardedAdjustment(
  sql: Sql,
  input: { listingId: string; expectedRevision: number },
): Promise<AdjustmentRow | undefined> {
  const rows = await sql<AdjustmentRow[]>`
    select * from moderation_adjustments
    where listing_id = ${input.listingId}
      and status = 'DISCARDED'
      and revision = ${input.expectedRevision}
    order by discarded_at desc
    limit 1
  `;
  return rows[0];
}

export interface AdjustmentAuditEventRow {
  action: string;
  actor_user_id: string;
  actor_display_name: string | null;
  created_at: Date;
  after_data: Record<string, unknown>;
}

/** Append-only save/discard lineage for the compact history read
    (correction G: multi-moderator attribution must be reconstructable). */
export async function listAdjustmentAuditEvents(
  sql: Sql,
  listingId: string,
): Promise<AdjustmentAuditEventRow[]> {
  return sql<AdjustmentAuditEventRow[]>`
    select a.action, a.actor_user_id, u.display_name as actor_display_name,
           a.created_at, a.after_data
    from audit_logs a
    left join users u on u.id = a.actor_user_id
    where a.entity_id = ${listingId}
      and a.action in ('MODERATION_ADJUSTMENT_SAVED', 'MODERATION_ADJUSTMENT_DISCARDED')
    order by a.created_at desc, a.id desc
  `;
}
