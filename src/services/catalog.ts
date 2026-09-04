import { ApiError } from "@/lib/api/errors";
import {
  findActiveBrandInCategory,
  findActiveCategoryByCode,
  listActiveBrandsByCategory,
  listActiveCategories,
  listActiveCities,
  listActiveFeatures,
  listActiveModels,
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

export async function getCategories(): Promise<CategoryDto[]> {
  const rows = await listActiveCategories();
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name_az,
    slug: row.slug,
  }));
}

export async function getBrands(categoryCode: string): Promise<BrandDto[]> {
  const category = await resolveActiveCategory(categoryCode);
  const rows = await listActiveBrandsByCategory(category.id);
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
}

export async function getModels(
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

export async function getCities(): Promise<CityDto[]> {
  const rows = await listActiveCities();
  return rows.map((row) => ({ id: row.id, name: row.name_az, slug: row.slug }));
}

export async function getReferenceOptions(
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

export async function getFeatures(
  categoryCode?: string,
): Promise<FeatureDto[]> {
  const category =
    categoryCode === undefined
      ? undefined
      : await resolveActiveCategory(categoryCode);
  const rows = await listActiveFeatures(category?.id);
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name_az }));
}
