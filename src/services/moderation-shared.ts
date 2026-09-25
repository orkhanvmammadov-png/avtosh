import { ApiError } from "@/lib/api/errors";
import type { Sql } from "@/lib/server/db/client";
import { findActiveCategoryByCode } from "@/repositories/catalog";
import { getUnreleasedClaim, type ClaimRow } from "@/repositories/moderation";

/**
 * O.13 Stage D — moderation helpers shared by the decision services
 * (moderation.ts, moderation-edit.ts) AND the adjustment service,
 * extracted verbatim from moderation-edit.ts into a leaf module so
 * moderation-edit can consume the adjustment-apply helpers without an
 * import cycle. No behavior change.
 */

function dataString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function dataNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  return typeof value === "number" ? value : null;
}

/** Resolve display names for arbitrary catalog ids (both sides of the
    diff, including inactive rows — historical names must still render). */
export async function nameMaps(sql: Sql): Promise<{
  of: (table: "brands" | "models" | "model_variants" | "cities" | "reference_options" | "features" | "categories", id: string | null) => Promise<string | null>;
}> {
  const cache = new Map<string, string | null>();
  return {
    of: async (table, id) => {
      if (id === null) return null;
      const key = `${table}:${id}`;
      if (cache.has(key)) return cache.get(key)!;
      let name: string | null = null;
      if (table === "brands") {
        name = (await sql<{ name: string }[]>`select name from brands where id = ${id}`)[0]?.name ?? null;
      } else if (table === "models") {
        name = (await sql<{ name: string }[]>`select name from models where id = ${id}`)[0]?.name ?? null;
      } else if (table === "model_variants") {
        name = (await sql<{ name: string }[]>`select name from model_variants where id = ${id}`)[0]?.name ?? null;
      } else if (table === "cities") {
        name = (await sql<{ name_az: string }[]>`select name_az from cities where id = ${id}`)[0]?.name_az ?? null;
      } else if (table === "reference_options") {
        name = (await sql<{ name_az: string }[]>`select name_az from reference_options where id = ${id}`)[0]?.name_az ?? null;
      } else if (table === "features") {
        name = (await sql<{ name_az: string }[]>`select name_az from features where id = ${id}`)[0]?.name_az ?? null;
      } else {
        name = (await sql<{ code: string }[]>`select code from categories where id = ${id}`)[0]?.code ?? null;
      }
      cache.set(key, name);
      return name;
    },
  };
}

/** The SAME live-claim ownership gate for every moderation write —
    never a parallel claim model. */
export async function requireOwnedLiveClaim(tx: Sql, listingId: string, moderatorId: string): Promise<ClaimRow> {
  const claim = await getUnreleasedClaim(tx, listingId);
  if (claim === undefined || claim.expires_at.getTime() <= Date.now()) {
    throw new ApiError("MODERATION_CLAIM_REQUIRED", "Claim the listing before deciding.");
  }
  if (claim.moderator_id !== moderatorId) {
    throw new ApiError("MODERATION_CLAIMED_BY_OTHER", "Another moderator holds the claim.");
  }
  return claim;
}

/** Sealed seller-editable column set the approval copy writes — and
    NOTHING else (no lifecycle/publication/payment/promotion columns).
    The ONE allowlisted mapping for O.12 edit approval and both O.13
    adjusted approvals — never a generic spread. */
export async function approvedContentSet(
  tx: Sql,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const categoryCode = dataString(data, "category");
  const category = categoryCode === null ? undefined : await findActiveCategoryByCode(categoryCode);
  if (category === undefined) {
    throw new ApiError("LISTING_INVALID_CATALOG_SELECTION", "The revision category is no longer valid.");
  }
  return {
    category_id: category.id,
    brand_id: dataString(data, "brand_id"),
    model_id: dataString(data, "model_id"),
    model_variant_id: dataString(data, "model_variant_id"),
    year: dataNumber(data, "year"),
    price_minor: dataNumber(data, "price_minor"),
    mileage: dataNumber(data, "mileage"),
    engine_cc: dataNumber(data, "engine_cc"),
    fuel_type_id: dataString(data, "fuel_type_id"),
    transmission_id: dataString(data, "transmission_id"),
    body_type_id: dataString(data, "body_type_id"),
    drive_type_id: dataString(data, "drive_type_id"),
    motorcycle_type_id: dataString(data, "motorcycle_type_id"),
    color_id: dataString(data, "color_id"),
    city_id: dataString(data, "city_id"),
    credit_available: data.credit_available === true,
    barter_available: data.barter_available === true,
    no_accident: data.no_accident === true ? true : null,
    not_repainted: data.not_repainted === true ? true : null,
    description: dataString(data, "description"),
    contact_phone_e164: dataString(data, "contact_phone"),
    seller_name: dataString(data, "seller_name"),
  };
}
