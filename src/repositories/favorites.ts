import type { Sql } from "@/lib/server/db/client";

/** Favorites repository — parameterized SQL only, always user-scoped. */

export interface FavoriteCardRow {
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
  published_at: Date | null;
  primary_image_path: string | null;
  favorited_at: Date;
  is_active: boolean;
}

/** Add target must be publicly visible (favoriting hidden listings would leak state). */
export async function findVisibleListingByPublicId(
  sql: Sql,
  publicId: number,
): Promise<{ id: string } | undefined> {
  const rows = await sql<{ id: string }[]>`
    select id from listings
    where public_id = ${publicId}
      and status = 'ACTIVE' and current_expires_at > now()
  `;
  return rows[0];
}

export async function addFavorite(sql: Sql, userId: string, listingId: string): Promise<void> {
  await sql`
    insert into favorites (user_id, listing_id)
    values (${userId}, ${listingId})
    on conflict do nothing
  `;
}

/** Removal is always allowed, even when the listing is no longer public. */
export async function removeFavoriteByPublicId(
  sql: Sql,
  userId: string,
  publicId: number,
): Promise<void> {
  await sql`
    delete from favorites f
    using listings l
    where f.user_id = ${userId} and f.listing_id = l.id and l.public_id = ${publicId}
  `;
}

export async function listFavoriteCards(sql: Sql, userId: string): Promise<FavoriteCardRow[]> {
  return sql<FavoriteCardRow[]>`
    select l.id, l.public_id::text as public_id, c.code as category,
           b.name as brand, m.name as model, l.year,
           l.price_minor::text as price_minor, l.currency, l.mileage,
           ci.name_az as city, l.published_at,
           (select li.storage_path from listing_images li
              where li.listing_id = l.id and li.is_primary limit 1) as primary_image_path,
           f.created_at as favorited_at,
           (l.status = 'ACTIVE' and l.current_expires_at > now()) as is_active
    from favorites f
    join listings l on l.id = f.listing_id
    join categories c on c.id = l.category_id
    left join brands b on b.id = l.brand_id
    left join models m on m.id = l.model_id
    left join cities ci on ci.id = l.city_id
    where f.user_id = ${userId}
    order by f.created_at desc, l.id desc
  `;
}

export async function listFavoritePublicIds(sql: Sql, userId: string): Promise<string[]> {
  const rows = await sql<{ public_id: string }[]>`
    select l.public_id::text as public_id
    from favorites f join listings l on l.id = f.listing_id
    where f.user_id = ${userId}
  `;
  return rows.map((r) => r.public_id);
}

export async function isFavorited(sql: Sql, userId: string, listingId: string): Promise<boolean> {
  const rows = await sql`
    select 1 from favorites where user_id = ${userId} and listing_id = ${listingId}
  `;
  return rows.length > 0;
}
