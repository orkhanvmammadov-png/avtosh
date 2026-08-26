import type { Sql } from "@/lib/server/db/client";

/**
 * Promotion purchase persistence (Phase 4.13). Pricing truth lives in
 * promotion_packages rows; every purchase snapshots price/duration
 * into the payment intent and, at fulfillment, into the
 * listing_promotions history row. The GiST exclusion constraint
 * (same-type SCHEDULED/ACTIVE periods never overlap) is defense in
 * depth behind the listing row lock used for extension arithmetic.
 */

export interface PromotionPackageRow {
  id: string;
  type: string;
  name: string;
  duration_days: number;
  price_minor: string;
  currency: string;
}

export async function listActivePromotionPackages(sql: Sql): Promise<PromotionPackageRow[]> {
  return sql<PromotionPackageRow[]>`
    select id, type::text as type, name, duration_days,
           price_minor::text as price_minor, currency
    from promotion_packages
    where is_active
    order by sort_order, duration_days
  `;
}

export async function findActivePackage(
  sql: Sql,
  packageId: string,
  type: string,
): Promise<PromotionPackageRow | undefined> {
  const rows = await sql<PromotionPackageRow[]>`
    select id, type::text as type, name, duration_days,
           price_minor::text as price_minor, currency
    from promotion_packages
    where id = ${packageId} and type = ${type}::promotion_type and is_active
  `;
  return rows[0];
}

export interface PromotionIntentRow {
  id: string;
  status: string;
  promotion_package_id: string | null;
  amount_minor: string;
  currency: string;
}

/** The single open (CREATED/PENDING) intent for a listing+type, locked. */
export async function lockOpenPromotionIntent(
  sql: Sql,
  listingId: string,
  type: string,
): Promise<PromotionIntentRow | undefined> {
  const rows = await sql<PromotionIntentRow[]>`
    select id, status::text as status, promotion_package_id,
           amount_minor::text as amount_minor, currency
    from payments
    where listing_id = ${listingId} and type = ${type}::payment_type
      and status in ('CREATED', 'PENDING')
    for update
  `;
  return rows[0];
}

export async function cancelPromotionIntent(sql: Sql, paymentId: string): Promise<void> {
  await sql`
    update payments set status = 'CANCELLED' where id = ${paymentId} and status = 'CREATED'
  `;
}

/**
 * Creates the immutable promotion payment intent (price/duration
 * snapshot from the package row at purchase time). Returns null when
 * the partial unique index reports a concurrent CREATED intent — the
 * caller re-reads and reuses the winner.
 */
export async function insertPromotionIntent(
  sql: Sql,
  input: {
    userId: string;
    listingId: string;
    type: string;
    packageId: string;
    amountMinor: number;
    currency: string;
    durationDays: number;
    idempotencyKey: string;
  },
): Promise<PromotionIntentRow | null> {
  const rows = await sql<PromotionIntentRow[]>`
    insert into payments
      (user_id, listing_id, type, amount_minor, currency, idempotency_key,
       status, fulfillment_status, promotion_package_id,
       package_duration_days, package_price_minor)
    values
      (${input.userId}, ${input.listingId}, ${input.type}::payment_type,
       ${input.amountMinor}, ${input.currency}, ${input.idempotencyKey},
       'CREATED', 'PENDING', ${input.packageId},
       ${input.durationDays}, ${input.amountMinor})
    on conflict do nothing
    returning id, status::text as status, promotion_package_id,
              amount_minor::text as amount_minor, currency
  `;
  return rows[0] ?? null;
}

/** Owner-scoped ACTIVE/unexpired listing for promotion purchase. */
export async function findPromotableListing(
  sql: Sql,
  listingId: string,
  ownerId: string,
): Promise<{ id: string; public_id: string; status: string; promotable: boolean } | undefined> {
  const rows = await sql<
    { id: string; public_id: string; status: string; promotable: boolean }[]
  >`
    select id, public_id::text as public_id, status::text as status,
           (status = 'ACTIVE' and current_expires_at > now()) as promotable
    from listings
    where id = ${listingId} and owner_id = ${ownerId}
  `;
  return rows[0];
}

/** Locks the listing row — serializes same-listing promotion fulfillments. */
export async function lockListingForPromotion(
  sql: Sql,
  listingId: string,
): Promise<{ id: string } | undefined> {
  const rows = await sql<{ id: string }[]>`
    select id from listings where id = ${listingId} for update
  `;
  return rows[0];
}

/**
 * Extension base: the latest end of same-type periods that are still
 * running or queued. Expired periods never extend (a new purchase
 * after expiry starts from fulfillment time).
 */
export async function currentPromotionEnd(
  sql: Sql,
  listingId: string,
  type: string,
): Promise<Date | null> {
  const rows = await sql<{ ends_at: Date | null }[]>`
    select max(ends_at) as ends_at
    from listing_promotions
    where listing_id = ${listingId} and type = ${type}::promotion_type
      and status in ('SCHEDULED', 'ACTIVE') and ends_at > now()
  `;
  return rows[0]?.ends_at ?? null;
}

export interface InsertedPromotionRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
}

/**
 * Activates/queues the purchased period in ONE statement. The
 * extension base is computed entirely in SQL — the latest end of
 * still-valid same-type periods, else now() — never round-tripped
 * through a JS Date (which would truncate microseconds and could
 * violate the [) exclusion constraint on exact-abut extension). The
 * row is ACTIVE when it starts immediately, SCHEDULED when queued
 * after remaining paid time. Callers hold the listing row lock, which
 * serializes concurrent extensions of the same listing.
 */
export async function insertPromotionPeriod(
  sql: Sql,
  input: {
    listingId: string;
    type: string;
    packageId: string | null;
    paymentId: string;
    durationDays: number;
    priceMinor: number;
  },
): Promise<InsertedPromotionRow> {
  const rows = await sql<InsertedPromotionRow[]>`
    insert into listing_promotions
      (listing_id, type, package_id, payment_id, starts_at, ends_at, status,
       purchased_duration_days, purchased_price_minor)
    select
      ${input.listingId}, ${input.type}::promotion_type, ${input.packageId},
      ${input.paymentId}, base.starts_at,
      base.starts_at + (${input.durationDays} || ' days')::interval,
      case when base.starts_at <= now() then 'ACTIVE' else 'SCHEDULED' end::promotion_status,
      ${input.durationDays}, ${input.priceMinor}
    from (
      select greatest(
        now(),
        coalesce(
          (select max(ends_at) from listing_promotions
            where listing_id = ${input.listingId}
              and type = ${input.type}::promotion_type
              and status in ('SCHEDULED', 'ACTIVE') and ends_at > now()),
          now()
        )
      ) as starts_at
    ) base
    returning id, starts_at, ends_at, status::text as status
  `;
  return rows[0];
}

/** Fulfilled promotion period for a payment (result page display). */
export async function findPromotionByPayment(
  sql: Sql,
  paymentId: string,
): Promise<{ type: string; ends_at: Date } | undefined> {
  const rows = await sql<{ type: string; ends_at: Date }[]>`
    select type::text as type, ends_at
    from listing_promotions
    where payment_id = ${paymentId}
    order by created_at desc
    limit 1
  `;
  return rows[0];
}

/** Current valid promotion ends per type for owner surfaces. */
export async function ownerPromotionState(
  sql: Sql,
  listingId: string,
): Promise<{ premium_until: Date | null; boost_until: Date | null }> {
  const rows = await sql<{ premium_until: Date | null; boost_until: Date | null }[]>`
    select
      (select max(ends_at) from listing_promotions
        where listing_id = ${listingId} and type = 'PREMIUM'
          and status in ('SCHEDULED','ACTIVE') and ends_at > now()) as premium_until,
      (select max(ends_at) from listing_promotions
        where listing_id = ${listingId} and type = 'BOOST'
          and status in ('SCHEDULED','ACTIVE') and ends_at > now()) as boost_until
  `;
  return rows[0];
}

/** Append-only audit entry for server-side promotion activation. */
export async function insertPromotionAudit(
  sql: Sql,
  input: {
    listingId: string;
    paymentId: string;
    type: string;
    startsAt: Date;
    endsAt: Date;
  },
): Promise<void> {
  await sql`
    insert into audit_logs (actor_user_id, actor_type, action, entity_type, entity_id, after_data)
    values (null, 'SYSTEM', 'PROMOTION_ACTIVATED', 'listing', ${input.listingId},
      ${sql.json({
        payment_id: input.paymentId,
        promotion_type: input.type,
        starts_at: input.startsAt.toISOString(),
        ends_at: input.endsAt.toISOString(),
      })})
  `;
}
