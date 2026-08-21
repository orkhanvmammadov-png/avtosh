import type { Sql } from "@/lib/server/db/client";

/**
 * Listing repository — parameterized SQL only. Handles are passed in
 * so services can compose transactions. Column names in dynamic
 * updates come exclusively from the server-side allowlist mapping,
 * never from request input.
 */

export interface ListingRow {
  id: string;
  public_id: string;
  owner_id: string;
  category_id: string;
  category_code: string;
  brand_id: string | null;
  model_id: string | null;
  year: number | null;
  price_minor: string | null;
  currency: string;
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
  description: string | null;
  contact_phone_e164: string | null;
  status: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

export async function createDraftListing(
  sql: Sql,
  ownerId: string,
  categoryId: string,
): Promise<ListingRow> {
  const rows = await sql<{ id: string }[]>`
    insert into listings (owner_id, category_id, status)
    values (${ownerId}, ${categoryId}, 'DRAFT')
    returning id
  `;
  const listing = await getOwnedListing(sql, rows[0].id, ownerId);
  return listing!;
}

export async function getOwnedListing(
  sql: Sql,
  listingId: string,
  ownerId: string,
): Promise<ListingRow | undefined> {
  const rows = await sql<ListingRow[]>`
    select
      l.id, l.public_id::text as public_id, l.owner_id, l.category_id,
      c.code as category_code,
      l.brand_id, l.model_id, l.year, l.price_minor::text as price_minor,
      l.currency, l.mileage, l.engine_cc, l.fuel_type_id, l.transmission_id,
      l.body_type_id, l.drive_type_id, l.motorcycle_type_id, l.color_id,
      l.city_id, l.credit_available, l.barter_available, l.description,
      l.contact_phone_e164, l.status, l.revision, l.created_at, l.updated_at
    from listings l
    join categories c on c.id = l.category_id
    where l.id = ${listingId} and l.owner_id = ${ownerId}
  `;
  return rows[0];
}

/** Locks the listing row (image limits / sort orders serialize on it). */
export async function getOwnedListingForUpdate(
  sql: Sql,
  listingId: string,
  ownerId: string,
): Promise<
  { id: string; status: string; revision: number; owner_id: string } | undefined
> {
  const rows = await sql<
    { id: string; status: string; revision: number; owner_id: string }[]
  >`
    select id, status, revision, owner_id
    from listings
    where id = ${listingId} and owner_id = ${ownerId}
    for update
  `;
  return rows[0];
}

/**
 * Optimistic-concurrency draft update: applies the allowlisted column
 * values and bumps revision atomically, only when the listing is
 * still the owner's DRAFT at the expected revision.
 */
export async function updateDraftListing(
  sql: Sql,
  input: {
    listingId: string;
    ownerId: string;
    expectedRevision: number;
    set: Record<string, unknown>;
  },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update listings
    set ${sql(input.set)}, revision = revision + 1
    where id = ${input.listingId}
      and owner_id = ${input.ownerId}
      and status = 'DRAFT'
      and revision = ${input.expectedRevision}
    returning id
  `;
  return rows.length > 0;
}

/** Revision bump for image mutations (seller-visible draft changes). */
export async function incrementListingRevision(
  sql: Sql,
  listingId: string,
): Promise<number> {
  const rows = await sql<{ revision: number }[]>`
    update listings set revision = revision + 1
    where id = ${listingId}
    returning revision
  `;
  return rows[0].revision;
}

// --- features ---------------------------------------------------------------

export async function getListingFeatureIds(
  sql: Sql,
  listingId: string,
): Promise<string[]> {
  const rows = await sql<{ feature_id: string }[]>`
    select feature_id from listing_features where listing_id = ${listingId}
  `;
  return rows.map((row) => row.feature_id);
}

export async function replaceListingFeatures(
  sql: Sql,
  listingId: string,
  featureIds: string[],
): Promise<void> {
  await sql`delete from listing_features where listing_id = ${listingId}`;
  if (featureIds.length > 0) {
    await sql`
      insert into listing_features (listing_id, feature_id)
      select ${listingId}, f.id from features f where f.id in ${sql(featureIds)}
      on conflict do nothing
    `;
  }
}

/** Removes features that are not valid for the (new) category. */
export async function removeIncompatibleListingFeatures(
  sql: Sql,
  listingId: string,
  categoryId: string,
): Promise<void> {
  await sql`
    delete from listing_features lf
    using features f
    where lf.listing_id = ${listingId}
      and f.id = lf.feature_id
      and not (f.is_active and (f.category_id is null or f.category_id = ${categoryId}))
  `;
}

/**
 * Full owner-scoped listing row, locked for the transaction. Used by
 * submission after the user row lock (lock order: users → listings).
 */
export async function getOwnedListingRowForUpdate(
  sql: Sql,
  listingId: string,
  ownerId: string,
): Promise<ListingRow | undefined> {
  const rows = await sql<ListingRow[]>`
    select
      l.id, l.public_id::text as public_id, l.owner_id, l.category_id,
      c.code as category_code,
      l.brand_id, l.model_id, l.year, l.price_minor::text as price_minor,
      l.currency, l.mileage, l.engine_cc, l.fuel_type_id, l.transmission_id,
      l.body_type_id, l.drive_type_id, l.motorcycle_type_id, l.color_id,
      l.city_id, l.credit_available, l.barter_available, l.description,
      l.contact_phone_e164, l.status, l.revision, l.created_at, l.updated_at
    from listings l
    join categories c on c.id = l.category_id
    where l.id = ${listingId} and l.owner_id = ${ownerId}
    for update of l
  `;
  return rows[0];
}
