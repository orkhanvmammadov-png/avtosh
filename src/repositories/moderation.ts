import type { Sql } from "@/lib/server/db/client";

/** Moderation repository — parameterized SQL only. */

export interface QueueRow {
  id: string;
  public_id: string;
  category_code: string;
  brand_name: string | null;
  model_name: string | null;
  year: number | null;
  price_minor: string | null;
  city_name: string | null;
  submitted_at: Date;
  /** Full-precision text form for keyset cursors (Date loses microseconds). */
  submitted_at_cursor: string;
  revision: number;
  owner_id: string;
  owner_phone: string;
  owner_display_name: string | null;
  primary_image_path: string | null;
  claim_moderator_id: string | null;
  claim_expires_at: Date | null;
}

export interface ModerationListingRow {
  id: string;
  public_id: string;
  status: string;
  revision: number;
  category_code: string;
  brand_id: string | null;
  brand_name: string | null;
  model_id: string | null;
  model_name: string | null;
  year: number | null;
  price_minor: string | null;
  currency: string;
  mileage: number | null;
  engine_cc: number | null;
  fuel_type: string | null;
  transmission: string | null;
  body_type: string | null;
  drive_type: string | null;
  motorcycle_type: string | null;
  color: string | null;
  city_name: string | null;
  credit_available: boolean;
  barter_available: boolean;
  description: string | null;
  contact_phone_e164: string | null;
  submitted_at: Date | null;
  published_at: Date | null;
  current_expires_at: Date | null;
  owner_id: string;
  owner_phone: string;
  owner_display_name: string | null;
  owner_status: string;
  created_at: Date;
}

export interface ClaimRow {
  id: string;
  listing_id: string;
  moderator_id: string;
  claimed_at: Date;
  expires_at: Date;
  released_at: Date | null;
}

export interface ReviewRow {
  id: string;
  listing_id: string;
  moderator_id: string;
  listing_revision: number;
  decision: "APPROVED" | "REJECTED" | "CORRECTION_REQUESTED";
  reason_code: string | null;
  note: string | null;
  reviewed_at: Date;
}

export interface LockedListingRow {
  id: string;
  owner_id: string;
  status: string;
  revision: number;
  published_at: Date | null;
}

export async function listModerationQueue(
  sql: Sql,
  input: { limit: number; after: { submittedAt: string; id: string } | null },
): Promise<QueueRow[]> {
  const cursorClause =
    input.after === null
      ? sql``
      // ::text::timestamptz keeps the cursor a TEXT parameter: a direct
      // ::timestamptz cast makes postgres.js serialize it through Date,
      // silently truncating microseconds and repeating boundary rows.
      : sql`and (l.submitted_at, l.id) > (${input.after.submittedAt}::text::timestamptz, ${input.after.id}::uuid)`;
  return sql<QueueRow[]>`
    select l.id, l.public_id::text as public_id, c.code as category_code,
           b.name as brand_name, m.name as model_name, l.year,
           l.price_minor::text as price_minor, ci.name_az as city_name,
           l.submitted_at, l.submitted_at::text as submitted_at_cursor, l.revision,
           u.id as owner_id, u.phone_e164 as owner_phone, u.display_name as owner_display_name,
           (select li.storage_path from listing_images li
              where li.listing_id = l.id and li.is_primary limit 1) as primary_image_path,
           mc.moderator_id as claim_moderator_id, mc.expires_at as claim_expires_at
    from listings l
    join categories c on c.id = l.category_id
    join users u on u.id = l.owner_id
    left join brands b on b.id = l.brand_id
    left join models m on m.id = l.model_id
    left join cities ci on ci.id = l.city_id
    left join moderation_claims mc
      on mc.listing_id = l.id and mc.released_at is null and mc.expires_at > now()
    where l.status = 'PENDING_MODERATION'
      -- Queue ordering/SLA is defined by submitted_at; a pending row
      -- without it violates the submission invariant and is excluded
      -- rather than crashing the queue (it can never be decided here).
      and l.submitted_at is not null
    ${cursorClause}
    order by l.submitted_at asc, l.id asc
    limit ${input.limit}
  `;
}

export async function getModerationListing(
  sql: Sql,
  listingId: string,
): Promise<ModerationListingRow | undefined> {
  const rows = await sql<ModerationListingRow[]>`
    select l.id, l.public_id::text as public_id, l.status, l.revision,
           c.code as category_code,
           l.brand_id, b.name as brand_name, l.model_id, m.name as model_name,
           l.year, l.price_minor::text as price_minor, l.currency, l.mileage, l.engine_cc,
           ft.name_az as fuel_type, tr.name_az as transmission, bt.name_az as body_type,
           dt.name_az as drive_type, mt.name_az as motorcycle_type, co.name_az as color,
           ci.name_az as city_name, l.credit_available, l.barter_available,
           l.description, l.contact_phone_e164, l.submitted_at, l.published_at,
           l.current_expires_at,
           u.id as owner_id, u.phone_e164 as owner_phone,
           u.display_name as owner_display_name, u.status as owner_status,
           l.created_at
    from listings l
    join categories c on c.id = l.category_id
    join users u on u.id = l.owner_id
    left join brands b on b.id = l.brand_id
    left join models m on m.id = l.model_id
    left join cities ci on ci.id = l.city_id
    left join reference_options ft on ft.id = l.fuel_type_id
    left join reference_options tr on tr.id = l.transmission_id
    left join reference_options bt on bt.id = l.body_type_id
    left join reference_options dt on dt.id = l.drive_type_id
    left join reference_options mt on mt.id = l.motorcycle_type_id
    left join reference_options co on co.id = l.color_id
    where l.id = ${listingId}
  `;
  return rows[0];
}

/** Staff lock on any listing (not owner-scoped). */
export async function lockListingForModeration(
  sql: Sql,
  listingId: string,
): Promise<LockedListingRow | undefined> {
  const rows = await sql<LockedListingRow[]>`
    select id, owner_id, status, revision, published_at
    from listings where id = ${listingId} for update
  `;
  return rows[0];
}

// --- claims -----------------------------------------------------------------

export async function getUnreleasedClaim(
  sql: Sql,
  listingId: string,
): Promise<ClaimRow | undefined> {
  const rows = await sql<ClaimRow[]>`
    select id, listing_id, moderator_id, claimed_at, expires_at, released_at
    from moderation_claims
    where listing_id = ${listingId} and released_at is null
  `;
  return rows[0];
}

export async function insertClaim(
  sql: Sql,
  input: { listingId: string; moderatorId: string; expiresAt: Date },
): Promise<ClaimRow> {
  const rows = await sql<ClaimRow[]>`
    insert into moderation_claims (listing_id, moderator_id, expires_at)
    values (${input.listingId}, ${input.moderatorId}, ${input.expiresAt})
    returning id, listing_id, moderator_id, claimed_at, expires_at, released_at
  `;
  return rows[0];
}

export async function extendClaim(
  sql: Sql,
  claimId: string,
  expiresAt: Date,
): Promise<ClaimRow> {
  const rows = await sql<ClaimRow[]>`
    update moderation_claims set expires_at = ${expiresAt}
    where id = ${claimId}
    returning id, listing_id, moderator_id, claimed_at, expires_at, released_at
  `;
  return rows[0];
}

export async function releaseClaim(sql: Sql, claimId: string): Promise<void> {
  await sql`
    update moderation_claims set released_at = now()
    where id = ${claimId} and released_at is null
  `;
}

// --- reviews ----------------------------------------------------------------

export async function insertReview(
  sql: Sql,
  input: {
    listingId: string;
    moderatorId: string;
    listingRevision: number;
    decision: ReviewRow["decision"];
    reasonCode: string | null;
    note: string | null;
  },
): Promise<ReviewRow> {
  const rows = await sql<ReviewRow[]>`
    insert into moderation_reviews
      (listing_id, moderator_id, listing_revision, decision, reason_code, note)
    values
      (${input.listingId}, ${input.moderatorId}, ${input.listingRevision},
       ${input.decision}::moderation_decision, ${input.reasonCode}, ${input.note})
    returning id, listing_id, moderator_id, listing_revision, decision,
              reason_code, note, reviewed_at
  `;
  return rows[0];
}

export async function listReviews(sql: Sql, listingId: string): Promise<ReviewRow[]> {
  return sql<ReviewRow[]>`
    select id, listing_id, moderator_id, listing_revision, decision,
           reason_code, note, reviewed_at
    from moderation_reviews
    where listing_id = ${listingId}
    order by reviewed_at desc, id desc
  `;
}

/** Existing identical decision (idempotent retry detection). */
export async function findMatchingReview(
  sql: Sql,
  input: {
    listingId: string;
    moderatorId: string;
    listingRevision: number;
    decision: ReviewRow["decision"];
  },
): Promise<ReviewRow | undefined> {
  const rows = await sql<ReviewRow[]>`
    select id, listing_id, moderator_id, listing_revision, decision,
           reason_code, note, reviewed_at
    from moderation_reviews
    where listing_id = ${input.listingId}
      and moderator_id = ${input.moderatorId}
      and listing_revision = ${input.listingRevision}
      and decision = ${input.decision}::moderation_decision
    order by reviewed_at desc
    limit 1
  `;
  return rows[0];
}

// --- activation -------------------------------------------------------------

export async function getValidityDays(sql: Sql): Promise<number | null> {
  const rows = await sql<{ value: unknown }[]>`
    select value from system_settings where key = 'listing.validity_days'
  `;
  const raw = rows[0]?.value;
  const value = typeof raw === "number" ? raw : Number(raw);
  return raw === undefined || !Number.isInteger(value) || value <= 0 ? null : value;
}

export async function nextPeriodNumber(sql: Sql, listingId: string): Promise<number> {
  const rows = await sql<{ next: number }[]>`
    select coalesce(max(period_number), 0) + 1 as next
    from listing_periods where listing_id = ${listingId}
  `;
  return Number(rows[0].next);
}

export async function insertListingPeriod(
  sql: Sql,
  input: {
    listingId: string;
    periodNumber: number;
    source: "INITIAL" | "RENEWAL";
    startsAt: Date;
    endsAt: Date;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into listing_periods
      (listing_id, period_number, source, starts_at, ends_at, status)
    values
      (${input.listingId}, ${input.periodNumber}, ${input.source}::listing_period_source,
       ${input.startsAt}, ${input.endsAt}, 'ACTIVE')
    returning id
  `;
  return rows[0].id;
}

export async function activateListing(
  sql: Sql,
  input: { listingId: string; expectedRevision: number; activatedAt: Date; expiresAt: Date },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update listings
    set status = 'ACTIVE',
        published_at = coalesce(published_at, ${input.activatedAt}),
        current_expires_at = ${input.expiresAt},
        needs_remoderation = false
    where id = ${input.listingId}
      and status = 'PENDING_MODERATION'
      and revision = ${input.expectedRevision}
    returning id
  `;
  return rows.length > 0;
}

export async function transitionFromPendingModeration(
  sql: Sql,
  input: {
    listingId: string;
    expectedRevision: number;
    toStatus: "REJECTED" | "CORRECTION_REQUIRED";
  },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update listings
    set status = ${input.toStatus}::listing_status
    where id = ${input.listingId}
      and status = 'PENDING_MODERATION'
      and revision = ${input.expectedRevision}
    returning id
  `;
  return rows.length > 0;
}

/** Seller resubmission: back into the queue with a fresh submitted_at. */
export async function resubmitListing(
  sql: Sql,
  input: { listingId: string; expectedRevision: number; fromStatuses: readonly string[] },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update listings
    set status = 'PENDING_MODERATION', submitted_at = now()
    where id = ${input.listingId}
      and status::text in ${sql([...input.fromStatuses])}
      and revision = ${input.expectedRevision}
    returning id
  `;
  return rows.length > 0;
}
