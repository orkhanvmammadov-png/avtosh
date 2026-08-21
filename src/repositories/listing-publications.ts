import type { Sql } from "@/lib/server/db/client";

/**
 * Publication accounting, payment intents, status history, outbox and
 * submission settings — parameterized SQL only, handles passed in so
 * the submission service composes one transaction.
 */

export interface PublicationRow {
  id: string;
  listing_id: string;
  user_id: string;
  publication_number: number;
  billing_type: "FREE" | "PAID";
  payment_id: string | null;
}

export interface PaymentRow {
  id: string;
  type: string;
  amount_minor: string;
  currency: string;
  status: string;
}

export interface SubmissionSettings {
  freeLimit: number;
  feeMinor: number;
  imageMin: number;
}

/**
 * Authoritative monetization/submission settings. Missing or corrupt
 * values fail closed — never a silent fallback for money rules.
 */
export async function getSubmissionSettings(
  sql: Sql,
): Promise<SubmissionSettings | null> {
  const rows = await sql<{ key: string; value: unknown }[]>`
    select key, value from system_settings
    where key in ('listing.free_publication_limit',
                  'listing.publication_fee_minor',
                  'listing.image_min')
  `;
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const int = (key: string, min: number): number | null => {
    const raw = map.get(key);
    const value = typeof raw === "number" ? raw : Number(raw);
    return raw === undefined || !Number.isInteger(value) || value < min
      ? null
      : value;
  };
  const freeLimit = int("listing.free_publication_limit", 0);
  const feeMinor = int("listing.publication_fee_minor", 0);
  const imageMin = int("listing.image_min", 1);
  if (freeLimit === null || feeMinor === null || imageMin === null) {
    return null;
  }
  return { freeLimit, feeMinor, imageMin };
}

/** Per-user serialization point for publication allocation. */
export async function lockUserRow(sql: Sql, userId: string): Promise<void> {
  await sql`select id from users where id = ${userId} for update`;
}

export async function getPublicationByListing(
  sql: Sql,
  listingId: string,
): Promise<PublicationRow | undefined> {
  const rows = await sql<PublicationRow[]>`
    select id, listing_id, user_id, publication_number, billing_type, payment_id
    from listing_publications
    where listing_id = ${listingId}
  `;
  return rows[0];
}

export async function countPublications(
  sql: Sql,
  userId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from listing_publications
    where user_id = ${userId}
  `;
  return Number(rows[0].count);
}

export async function nextPublicationNumber(
  sql: Sql,
  userId: string,
): Promise<number> {
  const rows = await sql<{ next: number }[]>`
    select coalesce(max(publication_number), 0) + 1 as next
    from listing_publications
    where user_id = ${userId}
  `;
  return Number(rows[0].next);
}

export async function insertPublication(
  sql: Sql,
  input: {
    listingId: string;
    userId: string;
    publicationNumber: number;
    billingType: "FREE" | "PAID";
    paymentId: string | null;
  },
): Promise<PublicationRow> {
  const rows = await sql<PublicationRow[]>`
    insert into listing_publications
      (listing_id, user_id, publication_number, billing_type, payment_id)
    values
      (${input.listingId}, ${input.userId}, ${input.publicationNumber},
       ${input.billingType}, ${input.paymentId})
    returning id, listing_id, user_id, publication_number, billing_type, payment_id
  `;
  return rows[0];
}

/** Internal pre-provider LISTING_FEE intent (provider NULL, CREATED). */
export async function insertListingFeeIntent(
  sql: Sql,
  input: {
    userId: string;
    listingId: string;
    amountMinor: number;
    idempotencyKey: string;
  },
): Promise<PaymentRow> {
  const rows = await sql<PaymentRow[]>`
    insert into payments
      (user_id, listing_id, type, amount_minor, currency, idempotency_key,
       status, fulfillment_status)
    values
      (${input.userId}, ${input.listingId}, 'LISTING_FEE', ${input.amountMinor},
       'AZN', ${input.idempotencyKey}, 'CREATED', 'PENDING')
    returning id, type, amount_minor::text as amount_minor, currency, status
  `;
  return rows[0];
}

export async function getPaymentById(
  sql: Sql,
  paymentId: string,
): Promise<PaymentRow | undefined> {
  const rows = await sql<PaymentRow[]>`
    select id, type, amount_minor::text as amount_minor, currency, status
    from payments where id = ${paymentId}
  `;
  return rows[0];
}

export async function countPrimaryImages(
  sql: Sql,
  listingId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from listing_images
    where listing_id = ${listingId} and is_primary
  `;
  return Number(rows[0].count);
}

export async function transitionListingFromDraft(
  sql: Sql,
  input: {
    listingId: string;
    toStatus: "PENDING_MODERATION" | "PAYMENT_REQUIRED";
    expectedRevision: number;
    setSubmittedAt: boolean;
  },
): Promise<boolean> {
  const rows = input.setSubmittedAt
    ? await sql<{ id: string }[]>`
        update listings
        set status = ${input.toStatus}::listing_status, submitted_at = now()
        where id = ${input.listingId}
          and status = 'DRAFT'
          and revision = ${input.expectedRevision}
        returning id
      `
    : await sql<{ id: string }[]>`
        update listings
        set status = ${input.toStatus}::listing_status
        where id = ${input.listingId}
          and status = 'DRAFT'
          and revision = ${input.expectedRevision}
        returning id
      `;
  return rows.length > 0;
}

/** Live pending uploads become non-confirmable once the draft is submitted. */
export async function expirePendingUploadsForListing(
  sql: Sql,
  listingId: string,
): Promise<void> {
  await sql`
    update listing_image_uploads
    set status = 'EXPIRED'
    where listing_id = ${listingId} and status = 'PENDING'
  `;
}

export async function insertStatusHistory(
  sql: Sql,
  input: {
    listingId: string;
    fromStatus: string;
    toStatus: string;
    actorUserId: string;
    reasonCode: string;
  },
): Promise<void> {
  await sql`
    insert into listing_status_history
      (listing_id, from_status, to_status, actor_user_id, actor_type, reason_code)
    values
      (${input.listingId}, ${input.fromStatus}::listing_status,
       ${input.toStatus}::listing_status, ${input.actorUserId}, 'USER',
       ${input.reasonCode})
  `;
}

export async function insertOutboxEvent(
  sql: Sql,
  input: {
    eventType: string;
    aggregateId: string;
    payload: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await sql`
    insert into outbox_events (event_type, aggregate_type, aggregate_id, payload)
    values (${input.eventType}, 'listing', ${input.aggregateId}, ${sql.json(input.payload)})
  `;
}
