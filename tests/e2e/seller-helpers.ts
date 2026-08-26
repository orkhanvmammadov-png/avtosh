import { randomUUID } from "node:crypto";
import postgres from "postgres";
import sharp from "sharp";
import { seed } from "./helpers";

/**
 * Controlled DB fixtures for seller-flow specs. Only used where the
 * scenario cannot reasonably be produced through the UI itself
 * (pre-existing lifecycle states, publication history, moderator
 * decisions); the flows under test always run through the real APIs.
 */

function db() {
  return postgres(seed().databaseUrl, { prepare: false, max: 1 });
}

export async function makeTestJpeg(width = 800, height = 600, seedColor = 40): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: seedColor, g: 90, b: 140 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

export interface ListingFixtureOptions {
  status: string;
  complete?: boolean;
  images?: number;
  feeMinor?: number;
  review?: { decision: string; reasonCode: string; note: string | null };
}

/** Inserts an owner listing in a given lifecycle state; returns ids. */
export async function insertListingFixture(
  ownerId: string,
  options: ListingFixtureOptions,
): Promise<{ id: string; publicId: string; revision: number }> {
  const s = seed();
  const sql = db();
  try {
    const status = options.status;
    const complete = options.complete ?? true;
    const submitted = ["PENDING_MODERATION", "CORRECTION_REQUIRED", "REJECTED", "ACTIVE", "SOLD", "EXPIRED", "SUSPENDED"].includes(status);
    const published = ["ACTIVE", "SOLD", "EXPIRED", "SUSPENDED"].includes(status);
    const [row] = await sql`
      insert into listings (owner_id, category_id, brand_id, model_id, city_id, year,
        price_minor, mileage, description, contact_phone_e164, status,
        submitted_at, published_at, current_expires_at, sold_at)
      values (${ownerId},
        (select id from categories where code = 'CAR'),
        ${complete ? s.toyotaBrandId : null}, ${complete ? s.corollaModelId : null},
        ${complete ? s.bakuCityId : null},
        ${complete ? 2021 : null}, ${complete ? 2500000 : null}, ${complete ? 64000 : null},
        ${complete ? "E2E fixture təsviri" : null}, ${complete ? "+994501234567" : null},
        ${status}::listing_status,
        ${submitted ? sql`now()` : null},
        ${published ? sql`now() - interval '1 day'` : null},
        ${status === "EXPIRED" ? sql`now() - interval '1 hour'` : published ? sql`now() + interval '20 days'` : null},
        ${status === "SOLD" ? sql`now()` : null})
      returning id, public_id::text as public_id, revision
    `;
    for (let i = 0; i < (options.images ?? 0); i += 1) {
      await sql`
        insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
        values (${row.id}, ${`listings/${randomUUID()}.webp`}, ${i}, ${i === 0}, 'image/webp', 1000, 1600, 900)
      `;
    }
    // Any state after submission implies an initial publication row —
    // resubmission correctly refuses listings that were never submitted.
    if (submitted) {
      await sql`
        insert into listing_publications (listing_id, user_id, publication_number, billing_type)
        values (${row.id}, ${ownerId},
          (select coalesce(max(publication_number), 0) + 1 from listing_publications where user_id = ${ownerId}),
          'FREE')
      `;
    }
    // PAYMENT_REQUIRED implies a real CREATED LISTING_FEE intent bound
    // through the PAID publication (mirrors the submit transaction).
    if (status === "PAYMENT_REQUIRED") {
      const [payment] = await sql`
        insert into payments (user_id, listing_id, type, amount_minor, currency, idempotency_key, status)
        values (${ownerId}, ${row.id}, 'LISTING_FEE', ${options.feeMinor ?? 200}, 'AZN',
          ${`listing_fee:initial:${row.id}`}, 'CREATED')
        returning id
      `;
      await sql`
        insert into listing_publications (listing_id, user_id, publication_number, billing_type, payment_id)
        values (${row.id}, ${ownerId},
          (select coalesce(max(publication_number), 0) + 1 from listing_publications where user_id = ${ownerId}),
          'PAID', ${payment.id})
      `;
    }
    if (options.review !== undefined) {
      const [moderator] = await sql`
        insert into users (phone_e164, display_name)
        values ('+994509990001', 'E2E Moderator')
        on conflict (phone_e164) do update set last_login_at = now()
        returning id
      `;
      await sql`
        insert into moderation_reviews (listing_id, moderator_id, listing_revision, decision, reason_code, note)
        values (${row.id}, ${moderator.id}, ${row.revision},
          ${options.review.decision}::moderation_decision,
          ${options.review.reasonCode}, ${options.review.note})
      `;
    }
    return { id: row.id, publicId: row.public_id, revision: row.revision };
  } finally {
    await sql.end();
  }
}

/**
 * Consumes N free publication slots for a user by inserting minimal
 * historical listings + publication rows (the boundary scenario for
 * paid submissions; building 3 full listings through the UI would test
 * nothing extra).
 */
export async function consumeFreePublications(ownerId: string, count: number): Promise<void> {
  const sql = db();
  try {
    for (let n = 1; n <= count; n += 1) {
      const [listing] = await sql`
        insert into listings (owner_id, category_id, status, submitted_at)
        values (${ownerId}, (select id from categories where code = 'CAR'),
          'PENDING_MODERATION', now())
        returning id
      `;
      await sql`
        insert into listing_publications (listing_id, user_id, publication_number, billing_type)
        values (${listing.id}, ${ownerId}, ${n}, 'FREE')
      `;
    }
  } finally {
    await sql.end();
  }
}

/** Simulates "another window" bumping the listing revision. */
export async function bumpListingRevision(listingId: string): Promise<void> {
  const sql = db();
  try {
    await sql`update listings set revision = revision + 1 where id = ${listingId}`;
  } finally {
    await sql.end();
  }
}

export async function listingCounts(ownerId: string): Promise<{ publications: number; payments: number }> {
  const sql = db();
  try {
    const [row] = await sql`
      select
        (select count(*)::int from listing_publications where user_id = ${ownerId}) as publications,
        (select count(*)::int from payments where user_id = ${ownerId}) as payments
    `;
    return { publications: row.publications, payments: row.payments };
  } finally {
    await sql.end();
  }
}

export async function listingStatus(listingId: string): Promise<string> {
  const sql = db();
  try {
    return (await sql`select status from listings where id = ${listingId}`)[0].status as string;
  } finally {
    await sql.end();
  }
}

/** Changes the publication-fee system setting (restore after use). */
export async function setListingFeeMinor(minor: number): Promise<void> {
  const sql = db();
  try {
    await sql`
      update system_settings set value = ${String(minor)}::jsonb
      where key = 'listing.publication_fee_minor'
    `;
  } finally {
    await sql.end();
  }
}

export async function getListingYear(listingId: string): Promise<number | null> {
  const sql = db();
  try {
    return (await sql`select year from listings where id = ${listingId}`)[0].year as number | null;
  } finally {
    await sql.end();
  }
}

export async function countFavorites(userId: string): Promise<number> {
  const sql = db();
  try {
    return (await sql`select count(*)::int as n from favorites where user_id = ${userId}`)[0].n as number;
  } finally {
    await sql.end();
  }
}

export interface ListingPaymentInfo {
  paymentId: string;
  paymentStatus: string;
  providerOrderId: string | null;
  activeAttempts: number;
  moderationOutbox: number;
  historyRows: number;
}

/** Payment/attempt state for a listing's LISTING_FEE intent. */
export async function paymentInfoForListing(listingId: string): Promise<ListingPaymentInfo> {
  const sql = db();
  try {
    const [row] = await sql`
      select p.id as payment_id, p.status::text as payment_status, p.provider_order_id,
        (select count(*)::int from payment_provider_attempts a where a.payment_id = p.id and not a.is_terminal) as active_attempts,
        (select count(*)::int from outbox_events o where o.aggregate_id = ${listingId} and o.event_type = 'LISTING_ENTERED_MODERATION') as moderation_outbox,
        (select count(*)::int from listing_status_history h where h.listing_id = ${listingId}) as history_rows
      from payments p
      join listing_publications pub on pub.payment_id = p.id
      where pub.listing_id = ${listingId}
    `;
    return {
      paymentId: row.payment_id as string,
      paymentStatus: row.payment_status as string,
      providerOrderId: row.provider_order_id as string | null,
      activeAttempts: row.active_attempts as number,
      moderationOutbox: row.moderation_outbox as number,
      historyRows: row.history_rows as number,
    };
  } finally {
    await sql.end();
  }
}

/** Kills every AVTOSH session of a user (expired-cookie scenarios). */
export async function clearUserSessions(userId: string): Promise<void> {
  const sql = db();
  try {
    await sql`delete from sessions where user_id = ${userId}`;
  } finally {
    await sql.end();
  }
}

/**
 * Ops-style fixture: marks the listing's active checkout attempt as
 * terminally failed and re-arms the intent (what a future operations
 * resolution of a failed provider attempt would do), so the RETRYABLE
 * result view and the fresh-checkout path can be exercised.
 */
export async function failListingCheckout(listingId: string): Promise<void> {
  const sql = db();
  try {
    await sql`
      update payment_provider_attempts a
      set is_terminal = true, succeeded = false, hpp_secret = null,
          provider_status = 'InitiationFailed', updated_at = now()
      from listing_publications pub
      where pub.payment_id = a.payment_id and pub.listing_id = ${listingId}
        and not a.is_terminal
    `;
    await sql`
      update payments p
      set status = 'CREATED'
      from listing_publications pub
      where pub.payment_id = p.id and pub.listing_id = ${listingId}
    `;
  } finally {
    await sql.end();
  }
}

/** Latest valid promotion end per type for a listing (or null). */
export async function promotionEnds(
  listingId: string,
  type: "PREMIUM" | "BOOST",
): Promise<string | null> {
  const sql = db();
  try {
    const [row] = await sql`
      select max(ends_at)::text as ends_at from listing_promotions
      where listing_id = ${listingId} and type = ${type}::promotion_type
        and status in ('SCHEDULED','ACTIVE') and ends_at > now()
    `;
    return (row.ends_at as string | null) ?? null;
  } finally {
    await sql.end();
  }
}

export async function promotionPeriodCount(listingId: string): Promise<number> {
  const sql = db();
  try {
    const [row] = await sql`
      select count(*)::int as n from listing_promotions where listing_id = ${listingId}
    `;
    return row.n as number;
  } finally {
    await sql.end();
  }
}

/**
 * Test cleanup: retires a fixture listing's promotions so shared-DB
 * public specs (seed-count assertions) stay unaffected across specs
 * and projects. Time-window truth: past ends_at removes all public
 * promotion behavior.
 */
export async function expireListingPromotions(listingId: string): Promise<void> {
  const sql = db();
  try {
    // Each row gets its own disjoint past window: even a blanket
    // status re-activation elsewhere can never trip the same-type
    // overlap exclusion constraint on these retired rows.
    await sql`
      update listing_promotions lp
      set starts_at = now() - (rn.n * interval '2 days'),
          ends_at = now() - (rn.n * interval '2 days') + interval '1 day',
          status = 'EXPIRED'
      from (
        select id, row_number() over (order by id) as n
        from listing_promotions where listing_id = ${listingId}
      ) rn
      where lp.id = rn.id
    `;
  } finally {
    await sql.end();
  }
}
