import { ApiError } from "@/lib/api/errors";
import { withTransientReadRetry } from "@/lib/server/db/read-retry";
import {
  findActiveBrandInCategory,
  findActiveCategoryByCode,
  findActiveModelInBrandCategory,
  listActiveBrandsByCategory,
  listActiveCategories,
  listActiveCities,
  listActiveFeatures,
  listActiveModelVariants,
  listActiveModels,
  listActiveModelsByIds,
  listActiveVariantsByIds,
  listActiveReferenceOptions,
  referenceGroupExists,
  type CategoryRow,
} from "@/repositories/catalog";

/**
 * Catalog service: resolves public codes to catalog identities,
 * enforces active-only and relationship semantics, and maps rows to
 * public DTOs. Semantics (documented in docs/api/catalog.md):
 * unknown/inactive category, group, or brand (including a brand not
 * linked to the requested category) → typed 400 error; a valid
 * combination with no rows → empty array.
 */

export interface CategoryDto {
  id: string;
  code: string;
  name: string;
  slug: string;
}

export interface BrandDto {
  id: string;
  name: string;
  slug: string;
}

export interface ModelDto {
  id: string;
  brandId: string;
  name: string;
  slug: string;
}

export interface ModelVariantDto {
  id: string;
  modelId: string;
  name: string;
  slug: string;
}

export interface CityDto {
  id: string;
  name: string;
  slug: string;
}

export interface ReferenceOptionDto {
  id: string;
  code: string;
  name: string;
  /** Presentation-only color swatch hex; null for non-color groups. */
  swatch?: string | null;
}

export interface FeatureDto {
  id: string;
  code: string;
  name: string;
  /** Stable equipment group code (O.11) — null for ungrouped legacy
      rows; AZ labels live in the shared frontend constants. */
  group: string | null;
}

async function resolveActiveCategory(code: string): Promise<CategoryRow> {
  const category = await findActiveCategoryByCode(code);
  if (category === undefined) {
    throw new ApiError(
      "CATALOG_INVALID_CATEGORY",
      "Unknown or inactive category.",
    );
  }
  return category;
}

async function getCategoriesLookup(): Promise<CategoryDto[]> {
  const rows = await listActiveCategories();
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name_az,
    slug: row.slug,
  }));
}

async function getBrandsLookup(categoryCode: string): Promise<BrandDto[]> {
  const category = await resolveActiveCategory(categoryCode);
  const rows = await listActiveBrandsByCategory(category.id);
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
}

async function getModelsLookup(
  categoryCode: string,
  brandId: string,
): Promise<ModelDto[]> {
  const category = await resolveActiveCategory(categoryCode);
  const brand = await findActiveBrandInCategory(brandId, category.id);
  if (brand === undefined) {
    throw new ApiError(
      "CATALOG_INVALID_BRAND",
      "Unknown, inactive, or not available in the requested category.",
    );
  }
  const rows = await listActiveModels(brandId, category.id);
  return rows.map((row) => ({
    id: row.id,
    brandId: row.brand_id,
    name: row.name,
    slug: row.slug,
  }));
}

/**
 * Active Alt models (variants) of one model family. The full
 * category → brand → model chain is validated so an id from another
 * brand or category yields a typed 400, never a foreign list. A
 * valid family with no variants returns an empty array — that is the
 * signal to hide the Alt model field and store NULL.
 */
async function getModelVariantsLookup(
  categoryCode: string,
  brandId: string,
  modelId: string,
): Promise<ModelVariantDto[]> {
  const category = await resolveActiveCategory(categoryCode);
  const brand = await findActiveBrandInCategory(brandId, category.id);
  if (brand === undefined) {
    throw new ApiError(
      "CATALOG_INVALID_BRAND",
      "Unknown, inactive, or not available in the requested category.",
    );
  }
  const model = await findActiveModelInBrandCategory(modelId, brandId, category.id);
  if (model === undefined) {
    throw new ApiError(
      "CATALOG_INVALID_MODEL",
      "Unknown, inactive, or not available for the requested brand.",
    );
  }
  const rows = await listActiveModelVariants(modelId);
  return rows.map((row) => ({
    id: row.id,
    modelId: row.model_id,
    name: row.name,
    slug: row.slug,
  }));
}

/**
 * Validated variant rows for a bounded id set (search restore/chips):
 * every id must be an active variant whose family belongs to the
 * brand and category, otherwise a typed 400.
 */
async function getModelVariantsByIdsLookup(
  categoryCode: string,
  brandId: string,
  variantIds: string[],
): Promise<ModelVariantDto[]> {
  if (variantIds.length === 0) return [];
  const category = await resolveActiveCategory(categoryCode);
  const brand = await findActiveBrandInCategory(brandId, category.id);
  if (brand === undefined) {
    throw new ApiError(
      "CATALOG_INVALID_BRAND",
      "Unknown, inactive, or not available in the requested category.",
    );
  }
  const unique = [...new Set(variantIds)];
  const rows = await listActiveVariantsByIds(unique);
  const parents = await listActiveModelsByIds(
    [...new Set(rows.map((row) => row.model_id))],
    brandId,
    category.id,
  );
  if (rows.length !== unique.length || parents.length !== new Set(rows.map((r) => r.model_id)).size) {
    throw new ApiError(
      "CATALOG_INVALID_MODEL",
      "Alt model is unknown, inactive, or not available for the requested brand.",
    );
  }
  return rows.map((row) => ({
    id: row.id,
    modelId: row.model_id,
    name: row.name,
    slug: row.slug,
  }));
}

async function getCitiesLookup(): Promise<CityDto[]> {
  const rows = await listActiveCities();
  return rows.map((row) => ({ id: row.id, name: row.name_az, slug: row.slug }));
}

async function getReferenceOptionsLookup(
  groupCode: string,
  categoryCode?: string,
): Promise<ReferenceOptionDto[]> {
  const groupExists = await referenceGroupExists(groupCode);
  if (!groupExists) {
    throw new ApiError("CATALOG_INVALID_GROUP", "Unknown reference group.");
  }
  const category =
    categoryCode === undefined
      ? undefined
      : await resolveActiveCategory(categoryCode);
  const rows = await listActiveReferenceOptions(groupCode, category?.id);
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name_az, swatch: row.swatch ?? null }));
}

async function getFeaturesLookup(
  categoryCode?: string,
): Promise<FeatureDto[]> {
  const category =
    categoryCode === undefined
      ? undefined
      : await resolveActiveCategory(categoryCode);
  const rows = await listActiveFeatures(category?.id);
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name_az, group: row.group_code }));
}

/**
 * RETRY ALLOWLIST — the only operations in the codebase that opt in
 * to the bounded transient-read retry. Every function above is a
 * pure catalog lookup (SELECT-only repositories plus typed ApiError
 * throws); running one twice has no side effect. Do NOT wrap
 * anything that authenticates, touches sessions, counts views,
 * writes, or runs a transaction.
 */
function pureCatalogRead<A extends unknown[], R>(
  operation: string,
  lookup: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args) => withTransientReadRetry(operation, () => lookup(...args));
}

export const getCategories = pureCatalogRead("catalog.getCategories", getCategoriesLookup);
export const getBrands = pureCatalogRead("catalog.getBrands", getBrandsLookup);
export const getModels = pureCatalogRead("catalog.getModels", getModelsLookup);
export const getModelVariants = pureCatalogRead("catalog.getModelVariants", getModelVariantsLookup);
export const getModelVariantsByIds = pureCatalogRead("catalog.getModelVariantsByIds", getModelVariantsByIdsLookup);
export const getCities = pureCatalogRead("catalog.getCities", getCitiesLookup);
export const getReferenceOptions = pureCatalogRead("catalog.getReferenceOptions", getReferenceOptionsLookup);
export const getFeatures = pureCatalogRead("catalog.getFeatures", getFeaturesLookup);
