import type { Sql } from "@/lib/server/db/client";
import type { SearchSort } from "@/lib/config/marketplace";

/**
 * Public marketplace read queries. Every public query includes the
 * central visibility fragment (ACTIVE AND current_expires_at > now())
 * and promotion validity is always time-checked — no scheduler is
 * ever trusted. All dynamic SQL pieces come from closed server code;
 * client values are bind parameters only.
 */

type Fragment = ReturnType<Sql>;

/** The public visibility invariant — the ONLY definition in the codebase. */
export function publicVisible(sql: Sql, alias = "l"): Fragment {
  return alias === "l"
    ? sql`l.status = 'ACTIVE' and l.current_expires_at > now()`
    : sql`lst.status = 'ACTIVE' and lst.current_expires_at > now()`;
}

/** Promotion currently valid: time window is truth; lagging status flips cannot hide/extend. */
function promotionValid(sql: Sql): Fragment {
  return sql`p.starts_at <= now() and p.ends_at > now() and p.status in ('SCHEDULED', 'ACTIVE')`;
}

export interface SearchFilters {
  categoryId: string;
  brandId?: string;
  modelId?: string;
  cityId?: string;
  priceMin?: number;
  priceMax?: number;
  yearMin?: number;
  yearMax?: number;
  mileageMax?: number;
  fuelTypeId?: string;
  transmissionId?: string;
  bodyTypeId?: string;
  driveTypeId?: string;
  motorcycleTypeId?: string;
  colorId?: string;
  credit?: boolean;
  barter?: boolean;
  featureIds?: string[];
}

export interface CardRow {
  id: string;
  public_id: string;
  category: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  price_minor: string | null;
  currency: string;
  mileage: number | null;
  city: string | null;
  published_at: Date;
  current_expires_at: Date;
  /** Earliest end of any currently valid promotion on the listing (cache bound). */
  promo_ends_at: Date | null;
  primary_image_path: string | null;
  is_premium: boolean;
  is_boosted: boolean;
  /** Present for Premium feed rows: current Premium activation time (text, full precision). */
  premium_since: string | null;
}

export interface SearchCursor {
  sort: SearchSort;
  value: string; // text form of the sort key (timestamp text, price, year)
  id: string;
}

function filterFragment(sql: Sql, f: SearchFilters): Fragment {
  const parts: Fragment[] = [sql`l.category_id = ${f.categoryId}`];
  if (f.brandId !== undefined) parts.push(sql`l.brand_id = ${f.brandId}`);
  if (f.modelId !== undefined) parts.push(sql`l.model_id = ${f.modelId}`);
  if (f.cityId !== undefined) parts.push(sql`l.city_id = ${f.cityId}`);
  if (f.priceMin !== undefined) parts.push(sql`l.price_minor >= ${f.priceMin}`);
  if (f.priceMax !== undefined) parts.push(sql`l.price_minor <= ${f.priceMax}`);
  if (f.yearMin !== undefined) parts.push(sql`l.year >= ${f.yearMin}`);
  if (f.yearMax !== undefined) parts.push(sql`l.year <= ${f.yearMax}`);
  if (f.mileageMax !== undefined) parts.push(sql`l.mileage <= ${f.mileageMax}`);
  if (f.fuelTypeId !== undefined) parts.push(sql`l.fuel_type_id = ${f.fuelTypeId}`);
  if (f.transmissionId !== undefined) parts.push(sql`l.transmission_id = ${f.transmissionId}`);
  if (f.bodyTypeId !== undefined) parts.push(sql`l.body_type_id = ${f.bodyTypeId}`);
  if (f.driveTypeId !== undefined) parts.push(sql`l.drive_type_id = ${f.driveTypeId}`);
  if (f.motorcycleTypeId !== undefined) parts.push(sql`l.motorcycle_type_id = ${f.motorcycleTypeId}`);
  if (f.colorId !== undefined) parts.push(sql`l.color_id = ${f.colorId}`);
  if (f.credit !== undefined) parts.push(sql`l.credit_available = ${f.credit}`);
  if (f.barter !== undefined) parts.push(sql`l.barter_available = ${f.barter}`);
  if (f.featureIds !== undefined && f.featureIds.length > 0) {
    // listing must carry ALL requested features
    parts.push(sql`not exists (
      select 1 from unnest(${f.featureIds}::uuid[]) as req(feature_id)
      where not exists (
        select 1 from listing_features lf
        where lf.listing_id = l.id and lf.feature_id = req.feature_id
      )
    )`);
  }
  return parts.reduce((acc, part) => sql`${acc} and ${part}`);
}

/** Closed sort map — never derived from client strings. */
function orderFragment(sql: Sql, sort: SearchSort): Fragment {
  switch (sort) {
    case "PRICE_ASC":
      return sql`l.price_minor asc, l.id asc`;
    case "PRICE_DESC":
      return sql`l.price_minor desc, l.id desc`;
    case "YEAR_DESC":
      return sql`l.year desc, l.id desc`;
    case "NEWEST":
    default:
      return sql`l.published_at desc, l.id desc`;
  }
}

function cursorFragment(sql: Sql, cursor: SearchCursor): Fragment {
  switch (cursor.sort) {
    case "PRICE_ASC":
      return sql`(l.price_minor, l.id) > (${cursor.value}::bigint, ${cursor.id}::uuid)`;
    case "PRICE_DESC":
      return sql`(l.price_minor, l.id) < (${cursor.value}::bigint, ${cursor.id}::uuid)`;
    case "YEAR_DESC":
      return sql`(l.year, l.id) < (${cursor.value}::int, ${cursor.id}::uuid)`;
    case "NEWEST":
    default:
      // ::text::timestamptz keeps microsecond precision (see moderation repo).
      return sql`(l.published_at, l.id) < (${cursor.value}::text::timestamptz, ${cursor.id}::uuid)`;
  }
}

const CARD_SELECT = (sql: Sql) => sql`
  l.id, l.public_id::text as public_id, c.code as category,
  b.name as brand, m.name as model, l.year, l.price_minor::text as price_minor,
  l.currency, l.mileage, ci.name_az as city, l.published_at, l.current_expires_at,
  (select min(p.ends_at) from listing_promotions p
     where p.listing_id = l.id and ${promotionValid(sql)}) as promo_ends_at,
  (select li.storage_path from listing_images li
     where li.listing_id = l.id and li.is_primary limit 1) as primary_image_path,
  exists (select 1 from listing_promotions p
          where p.listing_id = l.id and p.type = 'PREMIUM' and ${promotionValid(sql)}) as is_premium,
  exists (select 1 from listing_promotions p
          where p.listing_id = l.id and p.type = 'BOOST' and ${promotionValid(sql)}) as is_boosted
`;

const CARD_JOINS = (sql: Sql) => sql`
  from listings l
  join categories c on c.id = l.category_id
  left join brands b on b.id = l.brand_id
  left join models m on m.id = l.model_id
  left join cities ci on ci.id = l.city_id
`;

/**
 * Defense for keyset sorts: ACTIVE listings always carry price/year
 * (submission completeness), but a row violating that invariant would
 * poison NULL-key cursor tuples — exclude it from the affected sort.
 */
function sortKeyGuard(sql: Sql, sort: SearchSort): Fragment {
  switch (sort) {
    case "PRICE_ASC":
    case "PRICE_DESC":
      return sql`and l.price_minor is not null`;
    case "YEAR_DESC":
      return sql`and l.year is not null`;
    default:
      return sql``;
  }
}

/** Organic search page (limit+1 rows for has_more detection). */
export async function searchListings(
  sql: Sql,
  input: {
    filters: SearchFilters;
    sort: SearchSort;
    limit: number;
    cursor: SearchCursor | null;
    excludeIds: string[];
  },
): Promise<CardRow[]> {
  const cursor = input.cursor === null ? sql`` : sql`and ${cursorFragment(sql, input.cursor)}`;
  const exclude =
    input.excludeIds.length === 0 ? sql`` : sql`and l.id <> all(${input.excludeIds}::uuid[])`;
  return sql<CardRow[]>`
    select ${CARD_SELECT(sql)}, null::text as premium_since
    ${CARD_JOINS(sql)}
    where ${publicVisible(sql)}
      and ${filterFragment(sql, input.filters)}
      ${sortKeyGuard(sql, input.sort)}
      ${exclude}
      ${cursor}
    order by ${orderFragment(sql, input.sort)}
    limit ${input.limit}
  `;
}

/**
 * Boost candidates: the SAME visibility + filter fragment as organic
 * search, joined to a currently valid BOOST promotion — a Boost can
 * never bypass the user's filters by construction.
 */
export async function boostCandidates(
  sql: Sql,
  filters: SearchFilters,
  maxCandidates: number,
): Promise<CardRow[]> {
  return sql<CardRow[]>`
    select ${CARD_SELECT(sql)}, null::text as premium_since
    ${CARD_JOINS(sql)}
    where ${publicVisible(sql)}
      and ${filterFragment(sql, filters)}
      and exists (select 1 from listing_promotions p
                  where p.listing_id = l.id and p.type = 'BOOST' and ${promotionValid(sql)})
    order by l.id
    limit ${maxCandidates}
  `;
}

/**
 * Premium feed: one row per visible listing with a currently valid
 * PREMIUM promotion, ordered by newest current Premium activation.
 * Adjacent/historical promotion rows collapse via the lateral MAX.
 */
export async function premiumListings(
  sql: Sql,
  input: { limit: number; cursor: { value: string; id: string } | null },
): Promise<CardRow[]> {
  const cursor =
    input.cursor === null
      ? sql``
      : sql`and (pr.premium_since, l.id) < (${input.cursor.value}::text::timestamptz, ${input.cursor.id}::uuid)`;
  // Driven from listing_promotions (uses listing_promotions_type_status_ends)
  // rather than scanning every ACTIVE listing; MAX collapses adjacent /
  // historical Premium rows to one row per listing.
  return sql<CardRow[]>`
    select ${CARD_SELECT(sql)}, pr.premium_since::text as premium_since
    from (
      select p.listing_id, max(p.starts_at) as premium_since
      from listing_promotions p
      where p.type = 'PREMIUM' and ${promotionValid(sql)}
      group by p.listing_id
    ) pr
    join listings l on l.id = pr.listing_id
    join categories c on c.id = l.category_id
    left join brands b on b.id = l.brand_id
    left join models m on m.id = l.model_id
    left join cities ci on ci.id = l.city_id
    where ${publicVisible(sql)}
      ${cursor}
    order by pr.premium_since desc, l.id desc
    limit ${input.limit}
  `;
}

/** Publicly visible listings activated in the last 24 hours. */
export async function countNewLast24h(sql: Sql): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from listings l
    where ${publicVisible(sql)} and l.published_at > now() - interval '24 hours'
  `;
  return Number(rows[0].count);
}

/** Max configured first-view Boost capacity across device classes (fallback 4). */
export async function getBoostMaxSlots(sql: Sql): Promise<number> {
  const rows = await sql<{ value: unknown }[]>`
    select value from system_settings
    where key in ('boost.first_view_slots_desktop', 'boost.first_view_slots_tablet', 'boost.first_view_slots_mobile')
  `;
  const values = rows
    .map((r) => (typeof r.value === "number" ? r.value : Number(r.value)))
    .filter((v) => Number.isInteger(v) && v > 0 && v <= 20);
  return values.length === 0 ? 4 : Math.max(...values);
}

// --- detail -----------------------------------------------------------------

export interface DetailRow {
  id: string;
  public_id: string;
  status: string;
  current_expires_at: Date | null;
  category: string;
  brand: string | null;
  model: string | null;
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
  city: string | null;
  credit_available: boolean;
  barter_available: boolean;
  description: string | null;
  contact_phone_e164: string | null;
  seller_display_name: string | null;
  published_at: Date | null;
  sold_at: Date | null;
  promo_ends_at: Date | null;
  is_premium: boolean;
  is_boosted: boolean;
}

export async function getPublicDetail(
  sql: Sql,
  publicId: number,
): Promise<DetailRow | undefined> {
  const rows = await sql<DetailRow[]>`
    select l.id, l.public_id::text as public_id, l.status, l.current_expires_at,
           c.code as category, b.name as brand, m.name as model, l.year,
           l.price_minor::text as price_minor, l.currency, l.mileage, l.engine_cc,
           ft.name_az as fuel_type, tr.name_az as transmission, bt.name_az as body_type,
           dt.name_az as drive_type, mt.name_az as motorcycle_type, co.name_az as color,
           ci.name_az as city, l.credit_available, l.barter_available, l.description,
           l.contact_phone_e164, u.display_name as seller_display_name,
           l.published_at, l.sold_at,
           (select min(p.ends_at) from listing_promotions p
              where p.listing_id = l.id and ${promotionValid(sql)}) as promo_ends_at,
           exists (select 1 from listing_promotions p where p.listing_id = l.id
                   and p.type = 'PREMIUM' and ${promotionValid(sql)}) as is_premium,
           exists (select 1 from listing_promotions p where p.listing_id = l.id
                   and p.type = 'BOOST' and ${promotionValid(sql)}) as is_boosted
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
    where l.public_id = ${publicId}
  `;
  return rows[0];
}

export async function listPublicFeatureNames(
  sql: Sql,
  listingId: string,
): Promise<{ code: string; name: string }[]> {
  return sql<{ code: string; name: string }[]>`
    select f.code, f.name_az as name
    from listing_features lf join features f on f.id = lf.feature_id
    where lf.listing_id = ${listingId}
    order by f.sort_order, f.name_az
  `;
}

export async function listPublicImagePaths(
  sql: Sql,
  listingId: string,
): Promise<{ storage_path: string; width: number | null; height: number | null; is_primary: boolean }[]> {
  return sql<{ storage_path: string; width: number | null; height: number | null; is_primary: boolean }[]>`
    select storage_path, width, height, is_primary
    from listing_images where listing_id = ${listingId}
    order by sort_order, created_at
  `;
}

/** Best-effort aggregate view counter; never required for serving. */
export async function incrementViewCount(sql: Sql, listingId: string): Promise<void> {
  await sql`
    insert into listing_stats (listing_id, view_count) values (${listingId}, 1)
    on conflict (listing_id) do update set view_count = listing_stats.view_count + 1
  `;
}

/** Contact source for the public CTA: the LISTING contact phone only (never users.phone_e164). */
export async function getPublicContact(
  sql: Sql,
  publicId: number,
): Promise<{ id: string; status: string; current_expires_at: Date | null; contact_phone_e164: string | null } | undefined> {
  const rows = await sql<{ id: string; status: string; current_expires_at: Date | null; contact_phone_e164: string | null }[]>`
    select id, status, current_expires_at, contact_phone_e164
    from listings where public_id = ${publicId}
  `;
  return rows[0];
}

/** Best-effort aggregate phone-reveal counter (no per-event rows). */
export async function incrementPhoneRevealCount(sql: Sql, listingId: string): Promise<void> {
  await sql`
    insert into listing_stats (listing_id, phone_reveal_count) values (${listingId}, 1)
    on conflict (listing_id) do update set phone_reveal_count = listing_stats.phone_reveal_count + 1
  `;
}

// --- anonymous action rate limiting -----------------------------------------

export const CONTACT_REVEAL_ACTION = "CONTACT_REVEAL";

export async function countAnonymousActions(
  sql: Sql,
  input: { action: string; sourceHash: string; subjectId?: string; since: Date },
): Promise<number> {
  const subject = input.subjectId === undefined ? sql`` : sql`and subject_id = ${input.subjectId}`;
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from anonymous_action_events
    where action = ${input.action}
      and source_hash = ${input.sourceHash}
      and created_at > ${input.since}
      ${subject}
  `;
  return Number(rows[0].count);
}

export async function recordAnonymousAction(
  sql: Sql,
  input: { action: string; sourceHash: string; subjectId: string },
): Promise<void> {
  await sql`
    insert into anonymous_action_events (action, source_hash, subject_id)
    values (${input.action}, ${input.sourceHash}, ${input.subjectId})
  `;
}
