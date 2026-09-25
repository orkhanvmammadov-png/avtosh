import type { Sql } from "@/lib/server/db/client";

/**
 * O.12 seller-lifecycle persistence: owner-scoped locking reads and the
 * guarded visibility writes. seller_deactivated_at is cleared ONLY by
 * the central reactivation finalizer (service layer) — every write here
 * is revision-guarded and bumps listings.revision.
 */

export interface LifecycleListingRow {
  id: string;
  public_id: string;
  owner_id: string;
  category_id: string;
  category_code: string;
  brand_id: string | null;
  model_id: string | null;
  model_variant_id: string | null;
  year: number | null;
  price_minor: string | null;
  mileage: number | null;
  engine_cc: number | null;
  fuel_type_id: string | null;
  transmission_id: string | null;
  body_type_id: string | null;
  drive_type_id: string | null;
  motorcycle_type_id: string | null;
  color_id: string | null;
  city_id: string | null;
  credit_available: boolean;
  barter_available: boolean;
  no_accident: boolean | null;
  not_repainted: boolean | null;
  currency: string;
  description: string | null;
  contact_phone_e164: string | null;
  seller_name: string | null;
  status: string;
  revision: number;
  current_expires_at: Date | null;
  seller_deactivated_at: Date | null;
  seller_reactivation_requested_at: Date | null;
  sold_at: Date | null;
  deleted_at: Date | null;
}

/** Owner-scoped listing lock — FIRST lock in the O.12 lock order
    (listing row, then open revision row). */
export async function lockOwnedListingForLifecycle(
  sql: Sql,
  listingId: string,
  ownerId: string,
): Promise<LifecycleListingRow | undefined> {
  const rows = await sql<LifecycleListingRow[]>`
    select
      l.id, l.public_id::text as public_id, l.owner_id, l.category_id,
      c.code as category_code,
      l.brand_id, l.model_id, l.model_variant_id, l.year, l.price_minor::text as price_minor,
      l.mileage, l.engine_cc, l.fuel_type_id, l.transmission_id,
      l.body_type_id, l.drive_type_id, l.motorcycle_type_id, l.color_id,
      l.city_id, l.credit_available, l.barter_available,
      l.no_accident, l.not_repainted, l.currency, l.description,
      l.contact_phone_e164, l.seller_name,
      l.status, l.revision, l.current_expires_at,
      l.seller_deactivated_at, l.seller_reactivation_requested_at,
      l.sold_at, l.deleted_at
    from listings l
    join categories c on c.id = l.category_id
    where l.id = ${listingId} and l.owner_id = ${ownerId}
    for update of l
  `;
  return rows[0];
}

/** Owner-scoped plain read (no lock) — for read paths that must not
    hold row locks across storage signing (same shape). */
export async function getOwnedListingForLifecycle(
  sql: Sql,
  listingId: string,
  ownerId: string,
): Promise<LifecycleListingRow | undefined> {
  const rows = await sql<LifecycleListingRow[]>`
    select
      l.id, l.public_id::text as public_id, l.owner_id, l.category_id,
      c.code as category_code,
      l.brand_id, l.model_id, l.model_variant_id, l.year, l.price_minor::text as price_minor,
      l.mileage, l.engine_cc, l.fuel_type_id, l.transmission_id,
      l.body_type_id, l.drive_type_id, l.motorcycle_type_id, l.color_id,
      l.city_id, l.credit_available, l.barter_available,
      l.no_accident, l.not_repainted, l.currency, l.description,
      l.contact_phone_e164, l.seller_name,
      l.status, l.revision, l.current_expires_at,
      l.seller_deactivated_at, l.seller_reactivation_requested_at,
      l.sold_at, l.deleted_at
    from listings l
    join categories c on c.id = l.category_id
    where l.id = ${listingId} and l.owner_id = ${ownerId}
  `;
  return rows[0];
}

/** Non-owner-scoped variant for system/finalizer callers that already
    authorized the actor (same lock, same shape). */
export async function lockListingForLifecycle(
  sql: Sql,
  listingId: string,
): Promise<LifecycleListingRow | undefined> {
  const rows = await sql<LifecycleListingRow[]>`
    select
      l.id, l.public_id::text as public_id, l.owner_id, l.category_id,
      c.code as category_code,
      l.brand_id, l.model_id, l.model_variant_id, l.year, l.price_minor::text as price_minor,
      l.mileage, l.engine_cc, l.fuel_type_id, l.transmission_id,
      l.body_type_id, l.drive_type_id, l.motorcycle_type_id, l.color_id,
      l.city_id, l.credit_available, l.barter_available,
      l.no_accident, l.not_repainted, l.currency, l.description,
      l.contact_phone_e164, l.seller_name,
      l.status, l.revision, l.current_expires_at,
      l.seller_deactivated_at, l.seller_reactivation_requested_at,
      l.sold_at, l.deleted_at
    from listings l
    join categories c on c.id = l.category_id
    where l.id = ${listingId}
    for update of l
  `;
  return rows[0];
}

/** Deactivate: set the flag, clear any reactivation request (mutually
    exclusive intents), bump the listing counter. Never touches status,
    expiry, periods or promotions. */
export async function markSellerDeactivated(
  sql: Sql,
  input: { listingId: string; expectedRevision: number },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update listings
    set seller_deactivated_at = now(),
        seller_reactivation_requested_at = null,
        revision = revision + 1
    where id = ${input.listingId}
      and revision = ${input.expectedRevision}
      and status = 'ACTIVE'
      and seller_deactivated_at is null
    returning id
  `;
  return rows.length > 0;
}

/** Record the seller's explicit activation intent (idempotent — an
    existing request is kept, not refreshed, so audit keeps the first
    ask). */
export async function recordReactivationRequest(
  sql: Sql,
  input: { listingId: string; expectedRevision: number },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update listings
    set seller_reactivation_requested_at = coalesce(seller_reactivation_requested_at, now()),
        revision = revision + 1
    where id = ${input.listingId}
      and revision = ${input.expectedRevision}
      and seller_deactivated_at is not null
    returning id
  `;
  return rows.length > 0;
}

/** Finalizer-only visibility clear: every gate re-checked in SQL so the
    write is correct even against a state change between read and write
    (defense in depth under the row lock). */
export async function clearSellerDeactivation(
  sql: Sql,
  listingId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update listings
    set seller_deactivated_at = null,
        seller_reactivation_requested_at = null,
        revision = revision + 1
    where id = ${listingId}
      and seller_deactivated_at is not null
      and seller_reactivation_requested_at is not null
      and status = 'ACTIVE'
      and current_expires_at > now()
      and not exists (
        select 1 from listing_edit_revisions r
        where r.listing_id = listings.id
          and r.status in ('EDIT_DRAFT', 'PENDING_MODERATION', 'CORRECTION_REQUIRED')
      )
    returning id
  `;
  return rows.length > 0;
}

/** Clear a reactivation request without touching visibility (edit
    rejected/cancelled — the activation vehicle is gone). */
export async function clearReactivationRequest(
  sql: Sql,
  listingId: string,
): Promise<void> {
  await sql`
    update listings
    set seller_reactivation_requested_at = null,
        revision = revision + 1
    where id = ${listingId}
      and seller_reactivation_requested_at is not null
  `;
}
