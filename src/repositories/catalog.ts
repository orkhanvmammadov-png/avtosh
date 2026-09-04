import { getSql } from "@/lib/server/db/client";

/**
 * Catalog repository — database access only. All queries are
 * parameterized via postgres.js tagged templates; ordering is fixed
 * server-side; public reads return active rows only.
 */

export interface CategoryRow {
  id: string;
  code: string;
  name_az: string;
  slug: string;
}

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
}

export interface ModelRow {
  id: string;
  brand_id: string;
  name: string;
  slug: string;
}

export interface CityRow {
  id: string;
  name_az: string;
  slug: string;
}

export interface ReferenceOptionRow {
  id: string;
  code: string;
  name_az: string;
  /** Presentation-only swatch hex from metadata (colors); never identity. */
  swatch: string | null;
}

export interface FeatureRow {
  id: string;
  code: string;
  name_az: string;
}

export async function listActiveCategories(): Promise<CategoryRow[]> {
  const sql = getSql();
  return sql<CategoryRow[]>`
    select id, code, name_az, slug
    from categories
    where is_active
    order by sort_order, name_az
  `;
}

export async function findActiveCategoryByCode(
  code: string,
): Promise<CategoryRow | undefined> {
  const sql = getSql();
  const rows = await sql<CategoryRow[]>`
    select id, code, name_az, slug
    from categories
    where code = ${code} and is_active
  `;
  return rows[0];
}

export async function listActiveBrandsByCategory(
  categoryId: string,
): Promise<BrandRow[]> {
  const sql = getSql();
  return sql<BrandRow[]>`
    select b.id, b.name, b.slug
    from brands b
    join brand_categories bc on bc.brand_id = b.id
    where bc.category_id = ${categoryId} and b.is_active
    order by b.sort_order, b.name
  `;
}

/** Returns the brand only if it is active AND linked to the category. */
export async function findActiveBrandInCategory(
  brandId: string,
  categoryId: string,
): Promise<BrandRow | undefined> {
  const sql = getSql();
  const rows = await sql<BrandRow[]>`
    select b.id, b.name, b.slug
    from brands b
    join brand_categories bc on bc.brand_id = b.id
    where b.id = ${brandId} and bc.category_id = ${categoryId} and b.is_active
  `;
  return rows[0];
}

export async function listActiveModels(
  brandId: string,
  categoryId: string,
): Promise<ModelRow[]> {
  const sql = getSql();
  return sql<ModelRow[]>`
    select id, brand_id, name, slug
    from models
    where brand_id = ${brandId}
      and category_id = ${categoryId}
      and is_active
    order by sort_order, name
  `;
}

export async function listActiveCities(): Promise<CityRow[]> {
  const sql = getSql();
  return sql<CityRow[]>`
    select id, name_az, slug
    from cities
    where is_active
    order by sort_order, name_az
  `;
}

export async function referenceGroupExists(code: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    select 1 as one from reference_groups where code = ${code}
  `;
  return rows.length > 0;
}

/**
 * Active options of a group. With a category: global options
 * (category_id IS NULL) plus options scoped to that category. Without
 * a category: all active options of the group.
 */
export async function listActiveReferenceOptions(
  groupCode: string,
  categoryId?: string,
): Promise<ReferenceOptionRow[]> {
  const sql = getSql();
  if (categoryId === undefined) {
    return sql<ReferenceOptionRow[]>`
      select id, code, name_az, metadata->>'swatch' as swatch
      from reference_options
      where group_code = ${groupCode} and is_active
      order by sort_order, name_az
    `;
  }
  return sql<ReferenceOptionRow[]>`
    select id, code, name_az, metadata->>'swatch' as swatch
    from reference_options
    where group_code = ${groupCode}
      and is_active
      and (category_id is null or category_id = ${categoryId})
    order by sort_order, name_az
  `;
}

/** Point lookup: active model belonging to the brand AND category. */
export async function findActiveModelInBrandCategory(
  modelId: string,
  brandId: string,
  categoryId: string,
): Promise<ModelRow | undefined> {
  const sql = getSql();
  const rows = await sql<ModelRow[]>`
    select id, brand_id, name, slug
    from models
    where id = ${modelId}
      and brand_id = ${brandId}
      and category_id = ${categoryId}
      and is_active
  `;
  return rows[0];
}

export async function findActiveCityById(
  cityId: string,
): Promise<CityRow | undefined> {
  const sql = getSql();
  const rows = await sql<CityRow[]>`
    select id, name_az, slug from cities where id = ${cityId} and is_active
  `;
  return rows[0];
}

/**
 * Point lookup: active option of the expected group that is either
 * global or scoped to the given category.
 */
export async function findActiveReferenceOptionForCategory(
  optionId: string,
  groupCode: string,
  categoryId: string,
): Promise<ReferenceOptionRow | undefined> {
  const sql = getSql();
  const rows = await sql<ReferenceOptionRow[]>`
    select id, code, name_az
    from reference_options
    where id = ${optionId}
      and group_code = ${groupCode}
      and is_active
      and (category_id is null or category_id = ${categoryId})
  `;
  return rows[0];
}

/** IDs of the given features that are active and category-compatible. */
export async function filterActiveFeatureIdsForCategory(
  featureIds: string[],
  categoryId: string,
): Promise<string[]> {
  if (featureIds.length === 0) {
    return [];
  }
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    select id from features
    where id in ${sql(featureIds)}
      and is_active
      and (category_id is null or category_id = ${categoryId})
  `;
  return rows.map((row) => row.id);
}

/**
 * Active features. With a category: global features (category_id IS
 * NULL) plus features scoped to that category — the applicability
 * rule the accepted schema defines. Without a category: all active
 * features.
 */
export async function listActiveFeatures(
  categoryId?: string,
): Promise<FeatureRow[]> {
  const sql = getSql();
  if (categoryId === undefined) {
    return sql<FeatureRow[]>`
      select id, code, name_az
      from features
      where is_active
      order by sort_order, name_az
    `;
  }
  return sql<FeatureRow[]>`
    select id, code, name_az
    from features
    where is_active
      and (category_id is null or category_id = ${categoryId})
    order by sort_order, name_az
  `;
}
