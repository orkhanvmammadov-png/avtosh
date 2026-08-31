import type { Sql } from "@/lib/server/db/client";

/**
 * Renewal data access (Phase 4.16). The payment rows are the same
 * accepted `payments` model — RENEWAL is just another purpose with
 * its own open-intent uniqueness (migration 019) and an immutable
 * fee/duration snapshot taken from system_settings at intent time.
 */

export interface RenewableListingRow {
  id: string;
  public_id: string;
  status: string;
  current_expires_at: Date | null;
  brand: string | null;
  model: string | null;
  year: number | null;
}

/** Owner-scoped lookup — foreign/missing listings are indistinguishable. */
export async function findOwnerListingForRenewal(
  sql: Sql,
  listingId: string,
  ownerId: string,
): Promise<RenewableListingRow | undefined> {
  const rows = await sql<RenewableListingRow[]>`
    select l.id, l.public_id::text as public_id, l.status::text as status,
           l.current_expires_at, b.name as brand, m.name as model, l.year
    from listings l
    left join brands b on b.id = l.brand_id
    left join models m on m.id = l.model_id
    where l.id = ${listingId} and l.owner_id = ${ownerId} and l.status <> 'DELETED'
  `;
  return rows[0];
}

export interface RenewalSettings {
  feeMinor: number;
  durationDays: number;
}

/** Server-authoritative renewal pricing — the browser never supplies it. */
export async function getRenewalSettings(sql: Sql): Promise<RenewalSettings | null> {
  const rows = await sql<{ key: string; value: unknown }[]>`
    select key, value from system_settings
    where key in ('listing.renewal_fee_minor', 'listing.renewal_duration_days')
  `;
  const read = (key: string): number | null => {
    const raw = rows.find((row) => row.key === key)?.value;
    const value = typeof raw === "number" ? raw : Number(raw);
    return raw === undefined || !Number.isInteger(value) || value <= 0 ? null : value;
  };
  const feeMinor = read("listing.renewal_fee_minor");
  const durationDays = read("listing.renewal_duration_days");
  if (feeMinor === null || durationDays === null) {
    return null;
  }
  return { feeMinor, durationDays };
}

export interface RenewalIntentRow {
  id: string;
  status: string;
  amount_minor: string;
  currency: string;
  renewal_duration_days: number | null;
}

export async function lockOpenRenewalIntent(
  sql: Sql,
  listingId: string,
): Promise<RenewalIntentRow | undefined> {
  const rows = await sql<RenewalIntentRow[]>`
    select id, status::text as status, amount_minor::text as amount_minor,
           currency, renewal_duration_days
    from payments
    where listing_id = ${listingId} and type = 'RENEWAL'
      and status in ('CREATED', 'PENDING')
    for update
  `;
  return rows[0];
}

/** Non-locking read for the seller-facing renewal state page. */
export async function findOpenRenewalIntent(
  sql: Sql,
  listingId: string,
): Promise<RenewalIntentRow | undefined> {
  const rows = await sql<RenewalIntentRow[]>`
    select id, status::text as status, amount_minor::text as amount_minor,
           currency, renewal_duration_days
    from payments
    where listing_id = ${listingId} and type = 'RENEWAL'
      and status in ('CREATED', 'PENDING')
  `;
  return rows[0];
}

/**
 * Creates the immutable renewal intent (fee/duration snapshot from
 * settings at purchase time). Returns null when the partial unique
 * index reports a concurrent open intent — the caller re-reads and
 * reuses the winner.
 */
export async function insertRenewalIntent(
  sql: Sql,
  input: {
    userId: string;
    listingId: string;
    amountMinor: number;
    currency: string;
    durationDays: number;
    idempotencyKey: string;
  },
): Promise<RenewalIntentRow | null> {
  const rows = await sql<RenewalIntentRow[]>`
    insert into payments
      (user_id, listing_id, type, amount_minor, currency, idempotency_key,
       status, fulfillment_status, renewal_duration_days)
    values
      (${input.userId}, ${input.listingId}, 'RENEWAL',
       ${input.amountMinor}, ${input.currency}, ${input.idempotencyKey},
       'CREATED', 'PENDING', ${input.durationDays})
    on conflict do nothing
    returning id, status::text as status, amount_minor::text as amount_minor,
              currency, renewal_duration_days
  `;
  return rows[0] ?? null;
}

/** Row lock serializing renewal fulfillment against the listing. */
export async function lockListingForRenewal(
  sql: Sql,
  listingId: string,
): Promise<{ id: string; status: string; current_expires_at: Date | null } | undefined> {
  const rows = await sql<{ id: string; status: string; current_expires_at: Date | null }[]>`
    select id, status::text as status, current_expires_at
    from listings where id = ${listingId}
    for update
  `;
  return rows[0];
}

/** The renewal period created by a specific payment (result UX). */
export async function findRenewalPeriodByPayment(
  sql: Sql,
  paymentId: string,
): Promise<{ ends_at: Date } | undefined> {
  const rows = await sql<{ ends_at: Date }[]>`
    select ends_at from listing_periods
    where payment_id = ${paymentId} and source = 'RENEWAL'
  `;
  return rows[0];
}
