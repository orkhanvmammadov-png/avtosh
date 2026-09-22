import type { Sql } from "@/lib/server/db/client";

/**
 * Data access for the Phase 4.16 background workers. Every statement
 * is safe under overlapping executions: transitions are guarded by
 * the source status, batches are claimed with FOR UPDATE SKIP LOCKED,
 * and reminder identity rides the accepted `dedupe_key` unique
 * constraint. Public visibility never depends on these jobs — the
 * `status = 'ACTIVE' AND current_expires_at > now()` read-model
 * condition (Phase 4.8) is preserved untouched.
 */

// --- listing expiry ---------------------------------------------------------

/**
 * One expiry batch: claim up to `limit` overdue ACTIVE listings
 * (SKIP LOCKED so overlapping workers partition, never block), flip
 * them to EXPIRED, and record history + outbox for EXACTLY the rows
 * this execution transitioned — all one transaction. The correlated
 * `status = 'ACTIVE'` guard makes a double transition structurally
 * impossible.
 */
export async function expireListingsBatch(sql: Sql, limit: number): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    with due as (
      select id from listings
      where status = 'ACTIVE' and current_expires_at <= now()
      order by current_expires_at asc
      limit ${limit}
      for update skip locked
    ),
    flipped as (
      update listings l
      set status = 'EXPIRED'
      from due
      where l.id = due.id and l.status = 'ACTIVE'
      returning l.id
    ),
    history as (
      insert into listing_status_history
        (listing_id, from_status, to_status, actor_user_id, actor_type, reason_code)
      select id, 'ACTIVE', 'EXPIRED', null, 'SYSTEM', 'LISTING_EXPIRED' from flipped
    ),
    periods as (
      update listing_periods p
      set status = 'EXPIRED'
      from flipped
      where p.listing_id = flipped.id and p.status = 'ACTIVE' and p.ends_at <= now()
    ),
    outbox as (
      insert into outbox_events (event_type, aggregate_type, aggregate_id, payload)
      select 'LISTING_EXPIRED', 'listing', id,
             jsonb_build_object('listing_id', id)
      from flipped
    )
    select id from flipped
  `;
  return rows.map((row) => row.id);
}

// --- promotion status housekeeping ------------------------------------------

/**
 * Durable promotion-status sync. Public ranking already uses the time
 * window (Phase 4.8/4.13) — this only reconciles the stored status,
 * idempotently, without ever touching starts_at/ends_at or listing
 * publication expiry.
 */
export async function promotionHousekeepingBatch(
  sql: Sql,
  limit: number,
): Promise<{ activated: number; expired: number }> {
  const activated = await sql<{ id: string }[]>`
    with due as (
      select id from listing_promotions
      where status = 'SCHEDULED' and starts_at <= now() and ends_at > now()
      limit ${limit}
      for update skip locked
    )
    update listing_promotions p set status = 'ACTIVE'
    from due where p.id = due.id and p.status = 'SCHEDULED'
    returning p.id
  `;
  const expired = await sql<{ id: string }[]>`
    with due as (
      select id from listing_promotions
      where status in ('SCHEDULED', 'ACTIVE') and ends_at <= now()
      limit ${limit}
      for update skip locked
    )
    update listing_promotions p set status = 'EXPIRED'
    from due where p.id = due.id and p.status in ('SCHEDULED', 'ACTIVE')
    returning p.id
  `;
  return { activated: activated.length, expired: expired.length };
}

// --- expiry reminder scheduling ---------------------------------------------

export const EXPIRY_REMINDER_TYPE = "LISTING_EXPIRY_REMINDER";
/** Accepted schedule (CLAUDE.md): days before expiry. */
export const EXPIRY_REMINDER_OFFSETS_DAYS = [7, 5, 3, 1] as const;
/** Suggested send hour, Asia/Baku (UTC+4, no DST). */
export const EXPIRY_REMINDER_SEND_HOUR_BAKU = 10;
export const NOTIFICATION_TIMEZONE = "Asia/Baku";

/**
 * Idempotent period-scoped scheduling: for every CURRENT period of an
 * ACTIVE listing expiring within the reminder horizon, insert the
 * 7/5/3/1-day reminder rows whose send time
 * (expiry date − offset, at 10:00 Asia/Baku) is still in the future.
 * Identity: dedupe_key `LISTING_EXPIRY_REMINDER:<listing_period_id>:D<offset>`
 * (unique) — reruns and overlapping schedulers are no-ops, and a
 * renewal's NEW period gets a fresh identity set automatically while
 * the old period's rows can never match the new expiry. Send times
 * already in the past are never inserted (a stale "expires in 7 days"
 * is worse than silence).
 *
 * Recipient authority: the SELLER ACCOUNT phone (users.phone_e164 via
 * notifications.user_id) — the verified business identity. The
 * listing's contact_phone_e164 is the buyer-facing contact and may
 * belong to someone else; it is deliberately NOT used.
 */
export async function scheduleExpiryReminders(sql: Sql): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    insert into notifications
      (user_id, listing_id, listing_period_id, type, channel, template_code,
       template_version, scheduled_for, dedupe_key, payload)
    select
      l.owner_id, l.id, p.id,
      ${EXPIRY_REMINDER_TYPE}, 'WHATSAPP', ${EXPIRY_REMINDER_TYPE}, 1,
      s.send_at,
      ${EXPIRY_REMINDER_TYPE} || ':' || p.id || ':D' || d.offset_days,
      jsonb_build_object(
        'listing_public_id', l.public_id,
        'days_left', d.offset_days,
        'expires_on',
          to_char(p.ends_at at time zone ${NOTIFICATION_TIMEZONE}, 'DD.MM.YYYY'),
        'listing_title', trim(coalesce(b.name, '') || ' ' || coalesce(m.name, ''))
      )
    from listing_periods p
    join listings l on l.id = p.listing_id
    left join brands b on b.id = l.brand_id
    left join models m on m.id = l.model_id
    cross join (values (7), (5), (3), (1)) as d(offset_days)
    cross join lateral (
      select ((date_trunc('day', p.ends_at at time zone ${NOTIFICATION_TIMEZONE})
               - make_interval(days => d.offset_days))
              + make_interval(hours => ${EXPIRY_REMINDER_SEND_HOUR_BAKU}))
             at time zone ${NOTIFICATION_TIMEZONE} as send_at
    ) s
    where l.status = 'ACTIVE'
      and p.status = 'ACTIVE'
      and l.current_expires_at = p.ends_at
      and p.ends_at > now()
      and p.ends_at <= now() + interval '9 days'
      and s.send_at > now()
      and s.send_at < p.ends_at
    on conflict (dedupe_key) do nothing
    returning id
  `;
  return rows.length;
}

// --- notification sending ---------------------------------------------------

export interface ClaimedNotification {
  id: string;
  type: string;
  template_code: string;
  listing_id: string | null;
  listing_period_id: string | null;
  attempt_count: number;
  payload: Record<string, unknown>;
  recipient_phone: string;
}

/** Reclaim lease: PROCESSING rows older than this are considered abandoned. */
export const NOTIFICATION_PROCESSING_LEASE_MINUTES = 15;

/**
 * Single-statement claim: due SCHEDULED rows (respecting retry
 * backoff) plus abandoned PROCESSING rows move to PROCESSING with the
 * attempt counter bumped. FOR UPDATE SKIP LOCKED partitions
 * concurrent workers — a notification can be held by at most one
 * execution at a time.
 */
export async function claimDueNotifications(
  sql: Sql,
  limit: number,
): Promise<ClaimedNotification[]> {
  return sql<ClaimedNotification[]>`
    with due as (
      select id from notifications
      where (
          status = 'SCHEDULED'
          and scheduled_for <= now()
          and (next_retry_at is null or next_retry_at <= now())
        )
        or (
          status = 'PROCESSING'
          and updated_at < now() - make_interval(mins => ${NOTIFICATION_PROCESSING_LEASE_MINUTES})
        )
      order by scheduled_for asc
      limit ${limit}
      for update skip locked
    )
    update notifications n
    set status = 'PROCESSING', attempt_count = n.attempt_count + 1
    from due
    where n.id = due.id
    returning n.id, n.type, n.template_code, n.listing_id, n.listing_period_id,
              n.attempt_count, n.payload,
              (select u.phone_e164 from users u where u.id = n.user_id) as recipient_phone
  `;
}

export type ReminderEligibility = "SEND" | "DEFER" | "CANCEL";

/**
 * Send-time re-check for an expiry reminder (§ suppression policy):
 * - SEND    — listing still ACTIVE, this period is still the current
 *             one, and expiry is still ahead.
 * - DEFER   — listing SUSPENDED: hidden but the period may resume
 *             (admin restore); do not send a misleading message now,
 *             do not burn the identity — the row returns to SCHEDULED
 *             and auto-cancels once stale.
 * - CANCEL  — SOLD/DELETED/EXPIRED listing, superseded period
 *             (renewal happened), or the expiry moment has passed.
 */
export async function reminderEligibility(
  sql: Sql,
  notification: { listing_id: string | null; listing_period_id: string | null },
): Promise<ReminderEligibility> {
  if (notification.listing_id === null || notification.listing_period_id === null) {
    return "CANCEL";
  }
  const rows = await sql<{ status: string; is_current: boolean; still_ahead: boolean }[]>`
    select l.status::text as status,
           (l.current_expires_at = p.ends_at) as is_current,
           (p.ends_at > now()) as still_ahead
    from listings l
    join listing_periods p on p.id = ${notification.listing_period_id}
    where l.id = ${notification.listing_id}
  `;
  const row = rows[0];
  if (row === undefined) return "CANCEL";
  if (row.status === "SUSPENDED" && row.is_current && row.still_ahead) return "DEFER";
  if (row.status === "ACTIVE" && row.is_current && row.still_ahead) return "SEND";
  return "CANCEL";
}

export async function markNotificationSent(
  sql: Sql,
  id: string,
  providerMessageId: string | null,
): Promise<void> {
  await sql`
    update notifications
    set status = 'SENT', sent_at = now(), provider_message_id = ${providerMessageId},
        provider_error_code = null, next_retry_at = null
    where id = ${id} and status = 'PROCESSING'
  `;
}

export async function markNotificationCancelled(
  sql: Sql,
  id: string,
  reason: string,
): Promise<void> {
  await sql`
    update notifications
    set status = 'CANCELLED', cancel_reason = ${reason}, next_retry_at = null
    where id = ${id} and status = 'PROCESSING'
  `;
}

/** DEFER: return to SCHEDULED unchanged except a short retry hold. */
export async function deferNotification(
  sql: Sql,
  id: string,
  retryAt: Date,
): Promise<void> {
  await sql`
    update notifications
    set status = 'SCHEDULED', next_retry_at = ${retryAt},
        attempt_count = greatest(attempt_count - 1, 0)
    where id = ${id} and status = 'PROCESSING'
  `;
}

/** Transient failure: back to SCHEDULED with backoff, same identity. */
export async function scheduleNotificationRetry(
  sql: Sql,
  id: string,
  input: { retryAt: Date; errorCode: string },
): Promise<void> {
  await sql`
    update notifications
    set status = 'SCHEDULED', next_retry_at = ${input.retryAt},
        provider_error_code = ${input.errorCode}
    where id = ${id} and status = 'PROCESSING'
  `;
}

/** Permanent failure or retry budget exhausted. */
export async function markNotificationFailed(
  sql: Sql,
  id: string,
  errorCode: string,
): Promise<void> {
  await sql`
    update notifications
    set status = 'FAILED', provider_error_code = ${errorCode}, next_retry_at = null
    where id = ${id} and status = 'PROCESSING'
  `;
}

// --- O.12 image orphan cleanup ----------------------------------------------

export interface CleanupEventRow {
  id: string;
  event_type: string;
  attempt_count: number;
  payload: { cleanup_candidate_paths?: string };
}

/** Outbox event types whose payloads may carry storage cleanup
    CANDIDATES (cancel, seller staged-image removal, approval gallery
    replacement, reject). */
export const CLEANUP_EVENT_TYPES = [
  "LISTING_EDIT_CANCELLED",
  "LISTING_EDIT_IMAGE_REMOVED",
  "LISTING_EDIT_APPROVED",
  "LISTING_EDIT_REJECTED",
  // O.13 Stage C: adjusted NEW approval — candidates are the images the
  // moderator's plan removed from the final approved gallery. The
  // frozen submitted_images snapshot is metadata-only history (sealed
  // O.13.2 rule): it never blocks the reference check, which continues
  // to protect every LIVE gallery (listing_images, listing_edit_images).
  "MODERATION_ADJUSTMENT_APPLIED",
] as const;

/**
 * Claim a bounded batch of candidate-bearing outbox events for
 * processing. `for update skip locked` makes overlapping worker runs
 * safe; the grace interval guarantees a freshly-emitted candidate is
 * never deleted while its emitting flow could still be observed.
 */
export async function claimCleanupEvents(
  sql: Sql,
  input: { limit: number; graceSeconds: number },
): Promise<CleanupEventRow[]> {
  return sql<CleanupEventRow[]>`
    update outbox_events
    set status = 'PROCESSING', attempt_count = attempt_count + 1
    where id in (
      select id from outbox_events
      where event_type in ${sql([...CLEANUP_EVENT_TYPES])}
        and status = 'PENDING'
        and available_at <= now()
        and created_at <= now() - (${input.graceSeconds} || ' seconds')::interval
        and coalesce(payload->>'cleanup_candidate_paths', '') <> ''
      order by created_at asc
      for update skip locked
      limit ${input.limit}
    )
    returning id, event_type, attempt_count, payload
  `;
}

/** The authoritative reference check AT EXECUTION TIME: an object is a
    true orphan only when neither the approved gallery nor ANY staged
    revision row (open, APPROVED history, or terminal history) points
    at it. */
export async function isImagePathReferenced(sql: Sql, storagePath: string): Promise<boolean> {
  const rows = await sql<{ referenced: boolean }[]>`
    select
      exists (select 1 from listing_images where storage_path = ${storagePath})
      or exists (select 1 from listing_edit_images where storage_path = ${storagePath})
      as referenced
  `;
  return rows[0].referenced;
}

export async function markCleanupEventProcessed(sql: Sql, id: string): Promise<void> {
  await sql`
    update outbox_events
    set status = 'PROCESSED', processed_at = now(), last_error = null
    where id = ${id} and status = 'PROCESSING'
  `;
}

export async function markCleanupEventRetry(
  sql: Sql,
  input: { id: string; retryAt: Date; error: string },
): Promise<void> {
  await sql`
    update outbox_events
    set status = 'PENDING', available_at = ${input.retryAt}, last_error = ${input.error}
    where id = ${input.id} and status = 'PROCESSING'
  `;
}

export async function markCleanupEventFailed(
  sql: Sql,
  input: { id: string; error: string },
): Promise<void> {
  await sql`
    update outbox_events
    set status = 'FAILED', last_error = ${input.error}
    where id = ${input.id} and status = 'PROCESSING'
  `;
}
