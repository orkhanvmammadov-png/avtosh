import type { Sql } from "@/lib/server/db/client";

/**
 * Owner "My Listings" read model. Owner-scoped by definition — every
 * query filters on owner_id; DELETED follows the accepted owner
 * visibility rule (soft-deleted listings are not shown).
 */

export interface OwnerCardRow {
  id: string;
  public_id: string;
  status: string;
  revision: number;
  category: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  price_minor: string | null;
  currency: string;
  mileage: number | null;
  city: string | null;
  image_count: number;
  primary_image_path: string | null;
  created_at: Date;
  updated_at: Date;
  submitted_at: Date | null;
  published_at: Date | null;
  current_expires_at: Date | null;
  premium_until: Date | null;
  boost_until: Date | null;
  review_decision: string | null;
  review_reason_code: string | null;
  review_note: string | null;
  review_reviewed_at: Date | null;
}

export async function listOwnerListings(
  sql: Sql,
  ownerId: string,
  statuses: string[] | null,
): Promise<OwnerCardRow[]> {
  return sql<OwnerCardRow[]>`
    select
      l.id, l.public_id::text as public_id, l.status, l.revision,
      c.code as category, b.name as brand, m.name as model,
      l.year, l.price_minor::text as price_minor, l.currency, l.mileage,
      ci.name_az as city,
      (select count(*)::int from listing_images li2 where li2.listing_id = l.id) as image_count,
      (select li.storage_path from listing_images li
        where li.listing_id = l.id and li.is_primary limit 1) as primary_image_path,
      l.created_at, l.updated_at, l.submitted_at, l.published_at, l.current_expires_at,
      (select max(lp.ends_at) from listing_promotions lp
        where lp.listing_id = l.id and lp.type = 'PREMIUM'
          and lp.status in ('SCHEDULED','ACTIVE') and lp.ends_at > now()) as premium_until,
      (select max(lp.ends_at) from listing_promotions lp
        where lp.listing_id = l.id and lp.type = 'BOOST'
          and lp.status in ('SCHEDULED','ACTIVE') and lp.ends_at > now()) as boost_until,
      r.decision as review_decision, r.reason_code as review_reason_code,
      r.note as review_note, r.reviewed_at as review_reviewed_at
    from listings l
    join categories c on c.id = l.category_id
    left join brands b on b.id = l.brand_id
    left join models m on m.id = l.model_id
    left join cities ci on ci.id = l.city_id
    left join lateral (
      select mr.decision::text as decision, mr.reason_code, mr.note, mr.reviewed_at
      from moderation_reviews mr
      where mr.listing_id = l.id
      order by mr.reviewed_at desc, mr.id desc
      limit 1
    ) r on true
    where l.owner_id = ${ownerId}
      and l.status <> 'DELETED'
      ${statuses === null ? sql`` : sql`and l.status = any(${statuses}::listing_status[])`}
    order by l.updated_at desc, l.id desc
    limit 200
  `;
}

/** Latest review for one owner-verified listing (caller checks ownership). */
export async function findLatestReviewForListing(
  sql: Sql,
  listingId: string,
): Promise<{
  decision: string;
  reason_code: string | null;
  note: string | null;
  reviewed_at: Date;
} | undefined> {
  const rows = await sql<
    { decision: string; reason_code: string | null; note: string | null; reviewed_at: Date }[]
  >`
    select decision::text as decision, reason_code, note, reviewed_at
    from moderation_reviews
    where listing_id = ${listingId}
    order by reviewed_at desc, id desc
    limit 1
  `;
  return rows[0];
}

/**
 * The LISTING_FEE intent snapshot behind this listing's initial PAID
 * publication — resolved ONLY through the immutable
 * listing_publications.payment_id relationship (never "latest payment
 * by user"). The pub.user_id predicate makes cross-user leakage
 * structurally impossible even if a caller misuses the function.
 */
export async function findInitialPaidIntent(
  sql: Sql,
  listingId: string,
  ownerId: string,
): Promise<{
  type: string;
  amount_minor: string;
  currency: string;
  status: string;
} | undefined> {
  const rows = await sql<
    { type: string; amount_minor: string; currency: string; status: string }[]
  >`
    select p.type::text as type, p.amount_minor::text as amount_minor,
           p.currency, p.status::text as status
    from listing_publications pub
    join payments p on p.id = pub.payment_id
    where pub.listing_id = ${listingId}
      and pub.user_id = ${ownerId}
      and pub.billing_type = 'PAID'
  `;
  return rows[0];
}
