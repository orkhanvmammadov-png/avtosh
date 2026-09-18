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
  premium_intent_package_id: string | null;
  boost_intent_package_id: string | null;
  premium_intent_package_active: boolean | null;
  boost_intent_package_active: boolean | null;
  premium_satisfied: boolean;
  boost_satisfied: boolean;
  review_decision: string | null;
  review_reason_code: string | null;
  review_note: string | null;
  review_reviewed_at: Date | null;
  seller_deactivated_at: Date | null;
  seller_reactivation_requested_at: Date | null;
  edit_revision_id: string | null;
  edit_revision_status: string | null;
  edit_revision_submitted_at: Date | null;
}

export interface OwnerListFilter {
  statuses: string[] | null;
  /** O.12: "only" narrows to seller-deactivated rows; "exclude" hides
      them (the Aktiv tab must not carry Deaktiv-classified cards). */
  deactivated?: "only" | "exclude";
}

export async function listOwnerListings(
  sql: Sql,
  ownerId: string,
  filter: OwnerListFilter,
): Promise<OwnerCardRow[]> {
  const statuses = filter.statuses;
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
      -- O.9 creation-time promotion intent + Owner-decided satisfaction
      -- rule: ANY SUCCESS payment of the same type satisfies the
      -- intent (package match NOT required — a newer same-type
      -- purchase supersedes the old preference).
      l.premium_intent_package_id, l.boost_intent_package_id,
      pip.is_active as premium_intent_package_active,
      bip.is_active as boost_intent_package_active,
      exists (select 1 from payments p where p.listing_id = l.id
        and p.type = 'PREMIUM' and p.status = 'SUCCESS') as premium_satisfied,
      exists (select 1 from payments p where p.listing_id = l.id
        and p.type = 'BOOST' and p.status = 'SUCCESS') as boost_satisfied,
      r.decision as review_decision, r.reason_code as review_reason_code,
      r.note as review_note, r.reviewed_at as review_reviewed_at,
      l.seller_deactivated_at, l.seller_reactivation_requested_at,
      er.id as edit_revision_id, er.status as edit_revision_status,
      er.submitted_at as edit_revision_submitted_at
    from listings l
    join categories c on c.id = l.category_id
    left join brands b on b.id = l.brand_id
    left join models m on m.id = l.model_id
    left join cities ci on ci.id = l.city_id
    left join promotion_packages pip on pip.id = l.premium_intent_package_id
    left join promotion_packages bip on bip.id = l.boost_intent_package_id
    left join lateral (
      select mr.decision::text as decision, mr.reason_code, mr.note, mr.reviewed_at
      from moderation_reviews mr
      where mr.listing_id = l.id
      order by mr.reviewed_at desc, mr.id desc
      limit 1
    ) r on true
    left join lateral (
      -- the OPEN revision when one exists; otherwise the latest
      -- terminal one (the service keeps only APPROVED from terminals —
      -- the EXPIRED + "Dəyişiklik təsdiqlənib" awaiting-renewal chip)
      select rev.id, rev.status::text as status, rev.submitted_at
      from listing_edit_revisions rev
      where rev.listing_id = l.id
      order by (rev.status in ('EDIT_DRAFT', 'PENDING_MODERATION', 'CORRECTION_REQUIRED')) desc,
               rev.created_at desc
      limit 1
    ) er on true
    where l.owner_id = ${ownerId}
      and l.status <> 'DELETED'
      ${statuses === null ? sql`` : sql`and l.status = any(${statuses}::listing_status[])`}
      ${filter.deactivated === "only" ? sql`and l.seller_deactivated_at is not null` : sql``}
      ${filter.deactivated === "exclude" ? sql`and l.seller_deactivated_at is null` : sql``}
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
