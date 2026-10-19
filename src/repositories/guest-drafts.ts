import type { Sql } from "@/lib/server/db/client";
import type { ListingRow } from "@/repositories/listings";

/**
 * Guest draft repository — parameterized SQL only. Every read and
 * write is scoped by (guest_session_id, owner_id IS NULL) AND by the
 * session being unexpired AT QUERY TIME (expires_at > now()); cleanup
 * is an optimization, never a security dependency. Guest listings are
 * DRAFT-only (database CHECK), so no status allowlist is needed on
 * the guarded update.
 */

export interface GuestSessionRow {
  id: string;
  expires_at: Date;
}

export async function insertGuestSession(
  sql: Sql,
  input: { tokenHash: string; ipHash: string | null; expiresAt: Date },
): Promise<GuestSessionRow> {
  const rows = await sql<GuestSessionRow[]>`
    insert into guest_draft_sessions (token_hash, ip_hash, expires_at)
    values (${input.tokenHash}, ${input.ipHash}, ${input.expiresAt})
    returning id, expires_at
  `;
  return rows[0]!;
}

export async function findActiveGuestSessionByTokenHash(
  sql: Sql,
  tokenHash: string,
): Promise<GuestSessionRow | undefined> {
  const rows = await sql<GuestSessionRow[]>`
    select id, expires_at from guest_draft_sessions
    where token_hash = ${tokenHash} and expires_at > now()
  `;
  return rows[0];
}

export async function touchGuestSessionLastSeen(
  sql: Sql,
  sessionId: string,
): Promise<void> {
  await sql`
    update guest_draft_sessions set last_seen_at = now() where id = ${sessionId}
  `;
}

/** Locks the session row so the live-draft cap is race-safe. */
export async function lockActiveGuestSession(
  sql: Sql,
  sessionId: string,
): Promise<GuestSessionRow | undefined> {
  const rows = await sql<GuestSessionRow[]>`
    select id, expires_at from guest_draft_sessions
    where id = ${sessionId} and expires_at > now()
    for update
  `;
  return rows[0];
}

export async function countLiveGuestDrafts(
  sql: Sql,
  sessionId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from listings
    where guest_session_id = ${sessionId}
  `;
  return Number(rows[0]!.count);
}

export async function countGuestSessionsForIpSince(
  sql: Sql,
  ipHash: string,
  since: Date,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from guest_draft_sessions
    where ip_hash = ${ipHash} and created_at >= ${since}
  `;
  return Number(rows[0]!.count);
}

export async function countGuestDraftsForIpSince(
  sql: Sql,
  ipHash: string,
  since: Date,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from listings l
    join guest_draft_sessions s on s.id = l.guest_session_id
    where s.ip_hash = ${ipHash} and l.created_at >= ${since}
  `;
  return Number(rows[0]!.count);
}

const GUEST_LISTING_SELECT = (sql: Sql, listingId: string, sessionId: string) => sql<
  ListingRow[]
>`
  select
    l.id, l.public_id::text as public_id, l.owner_id, l.category_id,
    c.code as category_code,
    l.brand_id, l.model_id, l.model_variant_id, l.year, l.price_minor::text as price_minor,
    l.currency, l.mileage, l.engine_cc, l.fuel_type_id, l.transmission_id,
    l.body_type_id, l.drive_type_id, l.motorcycle_type_id, l.color_id,
    l.city_id, l.credit_available, l.barter_available, l.no_accident, l.not_repainted, l.description,
    l.contact_phone_e164, l.seller_name,
    l.premium_intent_package_id, l.boost_intent_package_id,
    l.status, l.revision, l.created_at, l.updated_at
  from listings l
  join categories c on c.id = l.category_id
  join guest_draft_sessions s
    on s.id = l.guest_session_id and s.expires_at > now()
  where l.id = ${listingId}
    and l.guest_session_id = ${sessionId}
    and l.owner_id is null
`;

export async function getGuestListing(
  sql: Sql,
  listingId: string,
  sessionId: string,
): Promise<ListingRow | undefined> {
  const rows = await GUEST_LISTING_SELECT(sql, listingId, sessionId);
  return rows[0];
}

export async function createGuestDraftListing(
  sql: Sql,
  sessionId: string,
  categoryId: string,
): Promise<ListingRow> {
  const rows = await sql<{ id: string }[]>`
    insert into listings (guest_session_id, category_id, status)
    values (${sessionId}, ${categoryId}, 'DRAFT')
    returning id
  `;
  const listing = await getGuestListing(sql, rows[0]!.id, sessionId);
  return listing!;
}

/**
 * Guarded guest draft update: same optimistic-concurrency shape as
 * updateDraftListing, scoped to the unexpired guest session. Status is
 * pinned to DRAFT explicitly (belt) on top of the database CHECK
 * (suspenders).
 */
export async function updateGuestDraftListing(
  sql: Sql,
  input: {
    listingId: string;
    sessionId: string;
    expectedRevision: number;
    set: Record<string, unknown>;
  },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update listings l
    set ${sql(input.set)}, revision = l.revision + 1
    from guest_draft_sessions s
    where l.id = ${input.listingId}
      and l.guest_session_id = ${input.sessionId}
      and l.owner_id is null
      and l.status = 'DRAFT'
      and l.revision = ${input.expectedRevision}
      and s.id = l.guest_session_id
      and s.expires_at > now()
    returning l.id
  `;
  return rows.length > 0;
}

// --- cleanup ------------------------------------------------------------------

export interface ExpiredGuestListingRow {
  id: string;
  guest_session_id: string;
}

/** Guest listings whose session expired more than `graceSeconds` ago. */
export async function listExpiredGuestListings(
  sql: Sql,
  graceSeconds: number,
  limit: number,
): Promise<ExpiredGuestListingRow[]> {
  return sql<ExpiredGuestListingRow[]>`
    select l.id, l.guest_session_id
    from listings l
    join guest_draft_sessions s on s.id = l.guest_session_id
    where s.expires_at < now() - make_interval(secs => ${graceSeconds})
    order by s.expires_at
    limit ${limit}
  `;
}

/**
 * Condemns ONE expired guest listing: locks the listings row, re-checks
 * under that lock that it is STILL an unclaimed guest draft whose
 * session expired past the grace window, enumerates its storage paths
 * (finals and temps separately — they live in different buckets), and
 * deletes the row. All inside the caller's transaction, no network.
 *
 * RACE-SAFE EXCLUSION CONTRACT with verify-and-claim (PR C): a claim
 * MUST be a single transaction whose guarded write targets the
 * listings row (`... where id = $ and guest_session_id = $session and
 * owner_id is null`). PostgreSQL row locking then leaves exactly two
 * interleavings: the claim commits first and this function's locked
 * re-check finds owner_id set (or the row re-homed) and condemns
 * nothing — storage is never touched; or this function commits first,
 * the row is gone, and the claim's guarded write matches zero rows —
 * a clean, retryable failure. Storage objects are deleted ONLY from
 * the durable record written in this same transaction, after commit,
 * so no interleaving can strip images from a successfully claimed
 * listing.
 */
export async function condemnExpiredGuestListing(
  sql: Sql,
  listingId: string,
  graceSeconds: number,
): Promise<
  | { condemned: false }
  | { condemned: true; imagePaths: string[]; uploadPaths: string[] }
> {
  const locked = await sql<{ id: string }[]>`
    select l.id
    from listings l
    join guest_draft_sessions s on s.id = l.guest_session_id
    where l.id = ${listingId}
      and l.owner_id is null
      and s.expires_at < now() - make_interval(secs => ${graceSeconds})
    for update of l
  `;
  if (locked.length === 0) {
    return { condemned: false };
  }
  const finals = await sql<{ storage_path: string }[]>`
    select storage_path from listing_images where listing_id = ${listingId}
  `;
  const temps = await sql<{ temp_storage_path: string }[]>`
    select temp_storage_path from listing_image_uploads
    where listing_id = ${listingId}
  `;
  await sql`delete from listings where id = ${listingId}`;
  return {
    condemned: true,
    imagePaths: finals.map((row) => row.storage_path),
    uploadPaths: temps.map((row) => row.temp_storage_path),
  };
}

export interface GuestCleanupEventRow {
  id: string;
  attempt_count: number;
  payload: {
    listing_id?: string;
    cleanup_image_paths?: string;
    cleanup_upload_paths?: string;
  };
}

export const GUEST_DRAFT_DELETED_EVENT = "GUEST_DRAFT_DELETED";

/**
 * Claims a bounded batch of guest-draft storage-cleanup events
 * (`for update skip locked` — overlapping runs are safe). Scoped to
 * GUEST_DRAFT_DELETED only; the sealed O.12/O.13 cleanup event types
 * stay with runImageCleanup.
 */
export async function claimGuestCleanupEvents(
  sql: Sql,
  limit: number,
): Promise<GuestCleanupEventRow[]> {
  return sql<GuestCleanupEventRow[]>`
    update outbox_events
    set status = 'PROCESSING', attempt_count = attempt_count + 1
    where id in (
      select id from outbox_events
      where event_type = ${GUEST_DRAFT_DELETED_EVENT}
        and status = 'PENDING'
        and available_at <= now()
      order by created_at asc
      for update skip locked
      limit ${limit}
    )
    returning id, attempt_count, payload
  `;
}

/** Execution-time re-check for TEMP objects (uploads bucket): a path
    still named by any listing_image_uploads row is not an orphan. */
export async function isUploadPathReferenced(
  sql: Sql,
  tempStoragePath: string,
): Promise<boolean> {
  const rows = await sql<{ referenced: boolean }[]>`
    select exists (
      select 1 from listing_image_uploads
      where temp_storage_path = ${tempStoragePath}
    ) as referenced
  `;
  return rows[0]!.referenced;
}

/** Expired sessions that no longer own any listing, bounded. */
export async function deleteExpiredGuestSessions(
  sql: Sql,
  graceSeconds: number,
  limit: number,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    delete from guest_draft_sessions s
    where s.id in (
      select id from guest_draft_sessions
      where expires_at < now() - make_interval(secs => ${graceSeconds})
        and not exists (
          select 1 from listings l where l.guest_session_id = guest_draft_sessions.id
        )
      limit ${limit}
    )
    returning s.id
  `;
  return rows.length;
}
