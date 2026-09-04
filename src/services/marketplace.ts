import { createHash } from "node:crypto";
import { maskPhone } from "@/auth/phone";
import { ApiError } from "@/lib/api/errors";
import { listingImageConfig } from "@/lib/config/listing-images";
import { marketplaceConfig, type SearchSort } from "@/lib/config/marketplace";
import { getSql } from "@/lib/server/db/client";
import { getStorageProvider } from "@/providers/storage/factory";
import {
  findActiveBrandInCategory,
  findActiveCategoryByCode,
  findActiveCityById,
  findActiveModelInBrandCategory,
  findActiveReferenceOptionForCategory,
  filterActiveFeatureIdsForCategory,
} from "@/repositories/catalog";
import {
  boostCandidates,
  CONTACT_REVEAL_ACTION,
  countAnonymousActions,
  countNewLast24h,
  getBoostMaxSlots,
  getPublicContact,
  getPublicDetail,
  incrementPhoneRevealCount,
  recordAnonymousAction,
  incrementViewCount,
  listPublicFeatureNames,
  listPublicImagePaths,
  premiumListings,
  searchListings,
  type CardRow,
  type SearchCursor,
  type SearchFilters,
} from "@/repositories/marketplace";
import { getCategories, type CategoryDto } from "@/services/catalog";
import type { SearchQuery } from "@/validators/marketplace";

/**
 * Public marketplace read model: anonymous, purpose-built DTOs, the
 * central visibility invariant applied by the repository, keyset
 * cursors, deterministic write-free Boost rotation, lazy Premium feed.
 */

// --- cache policy -----------------------------------------------------------

/**
 * Public responses may be cached only until the EARLIEST business
 * deadline they contain (listing current_expires_at, promotion
 * ends_at). Lifetime = min(configured ceiling, seconds until that
 * deadline); no stale-while-revalidate, because stale serving would
 * outlive the deadline. Deadlines within ~1 s (or already passed) →
 * no-store. Never relies on the expiry worker.
 */
export function publicCacheControl(earliestDeadline: Date | null, now: Date = new Date()): string {
  const config = marketplaceConfig();
  let maxAge = config.cacheMaxAgeSeconds;
  let sMaxAge = config.cacheSMaxAgeSeconds;
  if (earliestDeadline !== null) {
    const secondsLeft = Math.floor((earliestDeadline.getTime() - now.getTime()) / 1000);
    if (secondsLeft <= 1) {
      return "no-store";
    }
    maxAge = Math.min(maxAge, secondsLeft);
    sMaxAge = Math.min(sMaxAge, secondsLeft);
  }
  if (maxAge <= 0 && sMaxAge <= 0) {
    return "no-store";
  }
  return `public, max-age=${maxAge}, s-maxage=${sMaxAge}`;
}

function earliestDeadline(dates: (Date | null | undefined)[]): Date | null {
  let min: Date | null = null;
  for (const d of dates) {
    if (d instanceof Date && (min === null || d.getTime() < min.getTime())) min = d;
  }
  return min;
}

function cardDeadlines(rows: CardRow[]): (Date | null)[] {
  return rows.flatMap((r) => [r.current_expires_at, r.promo_ends_at]);
}

// --- DTOs -------------------------------------------------------------------

export interface PublicCardDto {
  publicId: string;
  category: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  priceMinor: number | null;
  currency: string;
  mileage: number | null;
  city: string | null;
  primaryImageUrl: string | null;
  publishedAt: string;
  badges: { premium: boolean; boosted: boolean };
}

export async function signPublicImage(path: string | null): Promise<string | null> {
  if (path === null) return null;
  const config = listingImageConfig();
  try {
    return await getStorageProvider().createSignedReadUrl(
      config.imagesBucket,
      path,
      config.publicReadTtlSeconds,
    );
  } catch {
    return null; // card-level graceful degradation; provider text never leaks
  }
}

async function toCard(row: CardRow): Promise<PublicCardDto> {
  return {
    publicId: row.public_id,
    category: row.category,
    brand: row.brand,
    model: row.model,
    year: row.year,
    priceMinor: row.price_minor === null ? null : Number(row.price_minor),
    currency: row.currency,
    mileage: row.mileage,
    city: row.city,
    primaryImageUrl: await signPublicImage(row.primary_image_path),
    publishedAt: row.published_at.toISOString(),
    badges: { premium: row.is_premium, boosted: row.is_boosted },
  };
}

async function toCards(rows: CardRow[]): Promise<PublicCardDto[]> {
  return Promise.all(rows.map(toCard));
}

// --- cursors ----------------------------------------------------------------

const CURSOR_VERSION = "v1";

export function encodeSearchCursor(sort: SearchSort, value: string, id: string): string {
  return Buffer.from(`${CURSOR_VERSION}|${sort}|${value}|${id}`).toString("base64url");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

/** Untrusted input: version, sort binding, and value shape are all enforced. */
export function decodeSearchCursor(cursor: string, expectedSort: SearchSort): SearchCursor {
  const invalid = () => new ApiError("VALIDATION_ERROR", "Invalid cursor.");
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw invalid();
  }
  const [version, sort, value, id] = decoded.split("|");
  if (version !== CURSOR_VERSION || sort !== expectedSort || value === undefined || id === undefined) {
    throw invalid();
  }
  if (!UUID.test(id)) throw invalid();
  const valueOk =
    sort === "NEWEST" ? TS.test(value) : /^-?\d{1,15}$/.test(value);
  if (!valueOk) throw invalid();
  return { sort: expectedSort, value, id };
}

function sortKeyValue(row: CardRow, sort: SearchSort, publishedAtText: string): string {
  switch (sort) {
    case "PRICE_ASC":
    case "PRICE_DESC":
      return row.price_minor ?? "0";
    case "YEAR_DESC":
      return String(row.year ?? 0);
    default:
      return publishedAtText;
  }
}

// --- Boost rotation ---------------------------------------------------------

/**
 * Deterministic, write-free fair rotation. For a given search
 * signature and hour bucket every candidate gets a pseudo-random but
 * stable score; the lowest N win. Stable within the hour (pagination
 * and refreshes agree), rotates every hour, no listing is permanently
 * favored, zero database writes.
 */
export function rotateBoosts<T extends { id: string }>(
  candidates: T[],
  searchSignature: string,
  slots: number,
  now: Date = new Date(),
): T[] {
  const hourBucket = Math.floor(now.getTime() / 3_600_000);
  const key = createHash("sha256").update(`${searchSignature}|${hourBucket}`).digest("hex");
  return [...candidates]
    .map((c) => ({
      c,
      score: createHash("sha256").update(`${key}|${c.id}`).digest("hex"),
    }))
    .sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0))
    .slice(0, slots)
    .map((x) => x.c);
}

function searchSignature(filters: SearchFilters, sort: SearchSort): string {
  const ordered = Object.entries(filters)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("&");
  return `${sort}?${ordered}`;
}

// --- filter resolution ------------------------------------------------------

const REFERENCE_FILTERS: {
  key: keyof SearchQuery;
  group: string;
  assign: (filters: SearchFilters, value: string) => void;
}[] = [
  { key: "body_type_id", group: "BODY_TYPE", assign: (f, v) => { f.bodyTypeId = v; } },
  { key: "drive_type_id", group: "DRIVE_TYPE", assign: (f, v) => { f.driveTypeId = v; } },
  { key: "motorcycle_type_id", group: "MOTORCYCLE_TYPE", assign: (f, v) => { f.motorcycleTypeId = v; } },
];

/**
 * Multi-select groups (4.17O.2): the canonical plural CSV param and
 * the legacy singular param merge into ONE deduplicated collection —
 * both spellings address the same filter, never separate buckets.
 */
const MULTI_REFERENCE_FILTERS: {
  pluralKey: "fuel_type_ids" | "transmission_ids" | "color_ids";
  singularKey: "fuel_type_id" | "transmission_id" | "color_id";
  group: string;
  assign: (filters: SearchFilters, values: string[]) => void;
}[] = [
  { pluralKey: "fuel_type_ids", singularKey: "fuel_type_id", group: "FUEL_TYPE", assign: (f, v) => { f.fuelTypeIds = v; } },
  { pluralKey: "transmission_ids", singularKey: "transmission_id", group: "TRANSMISSION", assign: (f, v) => { f.transmissionIds = v; } },
  { pluralKey: "color_ids", singularKey: "color_id", group: "COLOR", assign: (f, v) => { f.colorIds = v; } },
];

/** Validates filter relationships against current catalog data (catalog semantics reused). */
async function resolveFilters(query: SearchQuery): Promise<SearchFilters> {
  const category = await findActiveCategoryByCode(query.category);
  if (category === undefined) {
    throw new ApiError("CATALOG_INVALID_CATEGORY", "Unknown or inactive category.");
  }
  const filters: SearchFilters = { categoryId: category.id };
  if (query.brand_id !== undefined) {
    const brand = await findActiveBrandInCategory(query.brand_id, category.id);
    if (brand === undefined) {
      throw new ApiError("CATALOG_INVALID_BRAND", "Brand is not available in this category.");
    }
    filters.brandId = query.brand_id;
  }
  if (query.model_id !== undefined) {
    if (filters.brandId === undefined) {
      throw new ApiError("VALIDATION_ERROR", "model_id requires brand_id.");
    }
    const model = await findActiveModelInBrandCategory(query.model_id, filters.brandId, category.id);
    if (model === undefined) {
      throw new ApiError("CATALOG_INVALID_BRAND", "Model does not belong to the brand and category.");
    }
    filters.modelId = query.model_id;
  }
  if (query.city_id !== undefined) {
    if ((await findActiveCityById(query.city_id)) === undefined) {
      throw new ApiError("VALIDATION_ERROR", "Unknown or inactive city.");
    }
    filters.cityId = query.city_id;
  }
  for (const ref of REFERENCE_FILTERS) {
    const value = query[ref.key] as string | undefined;
    if (value === undefined) continue;
    const option = await findActiveReferenceOptionForCategory(value, ref.group, category.id);
    if (option === undefined) {
      throw new ApiError("CATALOG_INVALID_GROUP", `Invalid ${ref.group} filter for this category.`);
    }
    ref.assign(filters, value);
  }
  for (const ref of MULTI_REFERENCE_FILTERS) {
    const merged = [
      ...new Set([...(query[ref.pluralKey] ?? []), ...(query[ref.singularKey] !== undefined ? [query[ref.singularKey]] : [])]),
    ] as string[];
    if (merged.length === 0) continue;
    for (const value of merged) {
      const option = await findActiveReferenceOptionForCategory(value, ref.group, category.id);
      if (option === undefined) {
        throw new ApiError("CATALOG_INVALID_GROUP", `Invalid ${ref.group} filter for this category.`);
      }
    }
    ref.assign(filters, merged);
  }
  if (query.feature_ids !== undefined) {
    const valid = await filterActiveFeatureIdsForCategory(query.feature_ids, category.id);
    if (valid.length !== query.feature_ids.length) {
      throw new ApiError("VALIDATION_ERROR", "One or more features are invalid for this category.");
    }
    filters.featureIds = query.feature_ids;
  }
  if (query.price_min !== undefined) filters.priceMin = query.price_min;
  if (query.price_max !== undefined) filters.priceMax = query.price_max;
  if (query.year_min !== undefined) filters.yearMin = query.year_min;
  if (query.year_max !== undefined) filters.yearMax = query.year_max;
  if (query.mileage_max !== undefined) filters.mileageMax = query.mileage_max;
  if (query.engine_cc_min !== undefined) filters.engineCcMin = query.engine_cc_min;
  if (query.engine_cc_max !== undefined) filters.engineCcMax = query.engine_cc_max;
  if (query.credit !== undefined) filters.credit = query.credit;
  if (query.barter !== undefined) filters.barter = query.barter;
  // Positive-claim semantics: only TRUE ever filters (false = no filter).
  if (query.no_accident === true) filters.noAccident = true;
  if (query.not_repainted === true) filters.notRepainted = true;
  return filters;
}

// --- search -----------------------------------------------------------------

export interface SearchResultDto {
  promoted: PublicCardDto[];
  items: PublicCardDto[];
  nextCursor: string | null;
  hasMore: boolean;
  cacheControl: string;
  /**
   * Snapshot timestamp for this result set — the hydration-safe
   * reference the card freshness labels are computed against (the
   * SAME value serializes into the client tree, so SSR and hydration
   * render byte-identical text).
   */
  generatedAtMs: number;
}

export async function searchMarketplace(query: SearchQuery): Promise<SearchResultDto> {
  const sql = getSql();
  const config = marketplaceConfig();
  const limit = Math.min(query.limit ?? config.pageSize, config.maxPageSize);
  const filters = await resolveFilters(query);
  const cursor = query.cursor === undefined ? null : decodeSearchCursor(query.cursor, query.sort);

  // Boost placement only on the first page; promoted ids are excluded
  // from the organic first page so a listing never appears twice.
  let promotedRows: CardRow[] = [];
  if (cursor === null) {
    const slots = await getBoostMaxSlots(sql);
    const candidates = await boostCandidates(sql, filters, 50);
    promotedRows = rotateBoosts(candidates, searchSignature(filters, query.sort), slots);
  }

  const rows = await searchListings(sql, {
    filters,
    sort: query.sort,
    limit: limit + 1,
    cursor,
    excludeIds: promotedRows.map((r) => r.id),
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  let nextCursor: string | null = null;
  if (hasMore && last !== undefined) {
    const publishedText = await fullPrecisionPublishedAt(last.id);
    nextCursor = encodeSearchCursor(query.sort, sortKeyValue(last, query.sort, publishedText), last.id);
  }
  return {
    promoted: await toCards(promotedRows),
    items: await toCards(page),
    nextCursor,
    hasMore,
    cacheControl: publicCacheControl(
      earliestDeadline([...cardDeadlines(promotedRows), ...cardDeadlines(page)]),
    ),
    generatedAtMs: Date.now(),
  };
}

/** Keyset timestamps must round-trip at microsecond precision. */
async function fullPrecisionPublishedAt(listingId: string): Promise<string> {
  const sql = getSql();
  const rows = await sql<{ t: string }[]>`
    select published_at::text as t from listings where id = ${listingId}
  `;
  return rows[0]?.t ?? "";
}

// --- premium ----------------------------------------------------------------

export async function premiumFeed(input: {
  limit?: number;
  cursor?: string;
}): Promise<{ items: PublicCardDto[]; nextCursor: string | null; hasMore: boolean; cacheControl: string }> {
  const sql = getSql();
  const config = marketplaceConfig();
  const limit = Math.min(input.limit ?? config.pageSize, config.maxPageSize);
  let cursor: { value: string; id: string } | null = null;
  if (input.cursor !== undefined) {
    const decoded = decodeSearchCursor(input.cursor, "NEWEST"); // same shape: timestamp|id
    cursor = { value: decoded.value, id: decoded.id };
  }
  const rows = await premiumListings(sql, { limit: limit + 1, cursor });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: await toCards(page),
    nextCursor:
      hasMore && last !== undefined && last.premium_since !== null
        ? encodeSearchCursor("NEWEST", last.premium_since, last.id)
        : null,
    hasMore,
    cacheControl: publicCacheControl(earliestDeadline(cardDeadlines(page))),
  };
}

// --- home -------------------------------------------------------------------

export interface HomeDto {
  newListingsLast24h: number;
  categories: CategoryDto[];
  premium: { items: PublicCardDto[]; nextCursor: string | null; hasMore: boolean };
  /** Snapshot timestamp — hydration-safe freshness reference (see SearchResultDto). */
  generatedAtMs: number;
}

export async function homeData(): Promise<{ home: HomeDto; cacheControl: string }> {
  const sql = getSql();
  const [newListingsLast24h, categories, premiumPage] = await Promise.all([
    countNewLast24h(sql),
    getCategories(),
    premiumFeed({}),
  ]);
  const { cacheControl, ...premium } = premiumPage;
  return {
    home: { newListingsLast24h, categories, premium, generatedAtMs: Date.now() },
    cacheControl,
  };
}

// --- detail -----------------------------------------------------------------

export interface PublicDetailDto {
  publicId: string;
  status: "ACTIVE" | "SOLD" | "EXPIRED";
  contactable: boolean;
  category: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  priceMinor: number | null;
  currency: string;
  mileage: number | null;
  city: string | null;
  publishedAt: string | null;
  images: { url: string | null; width: number | null; height: number | null; isPrimary: boolean }[];
  badges: { premium: boolean; boosted: boolean };
  // Full-detail fields (null/empty for limited SOLD/EXPIRED views)
  engineCc: number | null;
  fuelType: string | null;
  transmission: string | null;
  bodyType: string | null;
  driveType: string | null;
  motorcycleType: string | null;
  color: string | null;
  creditAvailable: boolean | null;
  barterAvailable: boolean | null;
  /** Positive seller claims (true = claimed; null = no claim/unknown). */
  noAccident: boolean | null;
  notRepainted: boolean | null;
  description: string | null;
  features: { code: string; name: string }[];
  seller: { displayName: string | null; contactPhoneMasked: string | null } | null;
}

export async function publicDetail(
  publicId: number,
): Promise<{ listing: PublicDetailDto; cacheControl: string }> {
  const sql = getSql();
  const row = await getPublicDetail(sql, publicId);
  if (row === undefined) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  const timeValid = row.current_expires_at !== null && row.current_expires_at.getTime() > Date.now();
  let publicStatus: PublicDetailDto["status"];
  if (row.status === "ACTIVE" && timeValid) publicStatus = "ACTIVE";
  else if (row.status === "ACTIVE" || row.status === "EXPIRED") publicStatus = "EXPIRED";
  else if (row.status === "SOLD") publicStatus = "SOLD";
  else throw new ApiError("LISTING_NOT_FOUND", "Listing not found."); // never leak other states

  const imagePaths = await listPublicImagePaths(sql, row.id);
  const contactable = publicStatus === "ACTIVE";
  // Limited (SOLD/EXPIRED) views have no business deadline of their own;
  // contactable views are bounded by listing expiry and promotion ends.
  const cacheControl = contactable
    ? publicCacheControl(earliestDeadline([row.current_expires_at, row.promo_ends_at]))
    : publicCacheControl(null);
  const images = contactable
    ? await Promise.all(
        imagePaths.map(async (img) => ({
          url: await signPublicImage(img.storage_path),
          width: img.width,
          height: img.height,
          isPrimary: img.is_primary,
        })),
      )
    : await Promise.all(
        imagePaths
          .filter((img) => img.is_primary)
          .map(async (img) => ({
            url: await signPublicImage(img.storage_path),
            width: img.width,
            height: img.height,
            isPrimary: true,
          })),
      );

  const base = {
    publicId: row.public_id,
    status: publicStatus,
    contactable,
    category: row.category,
    brand: row.brand,
    model: row.model,
    year: row.year,
    priceMinor: row.price_minor === null ? null : Number(row.price_minor),
    currency: row.currency,
    mileage: row.mileage,
    city: row.city,
    publishedAt: row.published_at?.toISOString() ?? null,
    images,
    badges: contactable ? { premium: row.is_premium, boosted: row.is_boosted } : { premium: false, boosted: false },
  };
  if (!contactable) {
    return {
      listing: {
        ...base,
        engineCc: null, fuelType: null, transmission: null, bodyType: null, driveType: null,
        motorcycleType: null, color: null, creditAvailable: null, barterAvailable: null,
        noAccident: null, notRepainted: null,
        description: null, features: [], seller: null,
      },
      cacheControl,
    };
  }
  const features = await listPublicFeatureNames(sql, row.id);
  // Best-effort aggregate view count — never required for serving.
  await incrementViewCount(sql, row.id).catch(() => undefined);
  return {
    cacheControl,
    listing: {
    ...base,
    engineCc: row.engine_cc,
    fuelType: row.fuel_type,
    transmission: row.transmission,
    bodyType: row.body_type,
    driveType: row.drive_type,
    motorcycleType: row.motorcycle_type,
    color: row.color,
    creditAvailable: row.credit_available,
    barterAvailable: row.barter_available,
    noAccident: row.no_accident,
    notRepainted: row.not_repainted,
    description: row.description,
    features,
    seller: {
      displayName: row.seller_display_name,
      // Display-only masked contact; an abuse-protected reveal endpoint is a follow-up.
      contactPhoneMasked: row.contact_phone_e164 === null ? null : maskPhone(row.contact_phone_e164),
    },
    },
  };
}

// --- contact reveal ---------------------------------------------------------

export interface ContactRevealDto {
  phone: string;
  /** Outbound WhatsApp deep link built from the revealed digits only. */
  whatsappUrl: string;
}

/**
 * Explicit buyer action: reveals the LISTING contact phone for a
 * publicly visible (ACTIVE + unexpired) listing. Never falls back to
 * the seller's account phone; SOLD/EXPIRED/non-public → not found /
 * unavailable. Aggregate reveal counter is best-effort. Per-IP rate
 * limiting is a documented follow-up (no compatible infrastructure
 * exists without a new table); platform/WAF controls apply meanwhile.
 */
export async function revealListingContact(
  publicId: number,
  sourceHash: string | null,
): Promise<ContactRevealDto> {
  const sql = getSql();
  const row = await getPublicContact(sql, publicId);
  const visible =
    row !== undefined &&
    row.status === "ACTIVE" &&
    row.current_expires_at !== null &&
    row.current_expires_at.getTime() > Date.now();
  if (!visible) {
    throw new ApiError("LISTING_NOT_FOUND", "Listing not found.");
  }
  if (row.contact_phone_e164 === null) {
    throw new ApiError("LISTING_CONTACT_UNAVAILABLE", "Contact information is not available.");
  }
  // Technical anti-abuse windows (config): per source+listing and per
  // source overall. sourceHash is a keyed HMAC of the trusted client
  // IP (Phase 4.4 policy); when no trustworthy IP exists (local dev)
  // limiting is skipped rather than trusting fabrication — production
  // platforms always provide it. Small concurrent overshoot is
  // acceptable for an abuse threshold (not a business rule).
  if (sourceHash !== null) {
    const config = marketplaceConfig();
    const since = new Date(Date.now() - config.contactRevealWindowSeconds * 1000);
    const rateLimited = (): never => {
      throw new ApiError("CONTACT_RATE_LIMITED", "Too many contact requests. Try again later.", {
        details: { retry_after_seconds: config.contactRevealWindowSeconds },
      });
    };
    const perListing = await countAnonymousActions(sql, {
      action: CONTACT_REVEAL_ACTION, sourceHash, subjectId: row.id, since,
    });
    if (perListing >= config.contactRevealPerListing) rateLimited();
    const perSource = await countAnonymousActions(sql, {
      action: CONTACT_REVEAL_ACTION, sourceHash, since,
    });
    if (perSource >= config.contactRevealPerSource) rateLimited();
    await recordAnonymousAction(sql, { action: CONTACT_REVEAL_ACTION, sourceHash, subjectId: row.id });
  }
  await incrementPhoneRevealCount(sql, row.id).catch(() => undefined);
  const digits = row.contact_phone_e164.replace(/[^0-9]/g, "");
  return { phone: row.contact_phone_e164, whatsappUrl: `https://wa.me/${digits}` };
}
